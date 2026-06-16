'use client'

import { Link } from '@/navigation'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Plus, Sparkles, Copy, Check, ArrowLeft, AlertTriangle,
} from 'lucide-react'
import { Button, Input } from '@/components/design-system'

/**
 * /brands — focused CREATE-only page (Agent 13 redundancy strip).
 *
 * Why this page is no longer a manager:
 *   Listing brands, editing, deleting, filters and the "Performance globale"
 *   block all lived here AND on the establishment hub / the consolidated home —
 *   double surface, double navigation, "Mohammed s'y perd". We removed every
 *   redundant block:
 *     - LIST            → already in the hub ("Vos marques" cards).
 *     - FILTERS         → not needed at one establishment's scope.
 *     - PERF GLOBALE    → already in the consolidated home (overview endpoint).
 *     - EDIT / DELETE   → migrated as discrete affordances ON each hub card.
 *     - PRO BANNER      → unrelated to brand creation, removed.
 *
 * What's left: the ONLY thing /brands does now is CREATE a brand — either from
 * scratch, or by copying an existing brand into a target establishment. The
 * post-copy re-adoption follow-up (for creator dishes excluded by city
 * exclusivity, levier 3B) remains here because it's the natural continuation
 * of the copy flow.
 *
 * Sidebar fallback + the hub's "Add brand" / 0-brand empty CTA + the menu
 * page's "Configure my brand" CTA all continue pointing here — no broken
 * links, no dead page, single source of truth for creation.
 */

type BrandSummary = {
  id:       string
  name:     string
  emoji:    string
  status:   string
}

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

interface BrandForm {
  name:        string
  emoji:       string
  cuisineType: string
  tagline:     string
}

type ReadoptStatus = 'idle' | 'loading' | 'done' | 'taken' | 'error'
interface ReadoptItem { creatorDishId: string; name: string; sellingPrice: number; status: ReadoptStatus }
interface ReadoptState { brandId: string; items: ReadoptItem[] }

function BrandsCreateInner() {
  const t = useTranslations('brands')

  // The establishment the operator clicked "Ajouter une marque" from, passed by
  // the hub as ?restaurantId=… so the new brand attaches to THAT establishment
  // instead of the cookie-selected / oldest one. Ownership is enforced server-side
  // (POST /api/brands rejects a foreign id with 400) — never resolved by city.
  const searchParams          = useSearchParams()
  const requestedRestaurantId = searchParams.get('restaurantId')

  // Existing brands (used as the source list for the copy mode + as a guard
  // ("you can't copy if you have none yet")).
  const [brands, setBrands] = useState<BrandSummary[]>([])
  const [establishments, setEstablishments] = useState<EstablishmentLite[]>([])
  const [currentEstablishmentId, setCurrentEstablishmentId] = useState<string | null>(null)

  // Mode toggle.
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
      const data = await res.json()
      if (Array.isArray(data?.brands)) setBrands(data.brands)
    } catch { /* degrade silently */ }
  }, [])

  const loadEstablishments = useCallback(async () => {
    try {
      const res  = await fetch('/api/establishments', { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data?.establishments)) setEstablishments(data.establishments)
      if (typeof data?.currentId === 'string') setCurrentEstablishmentId(data.currentId)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!cancelled) await Promise.all([loadBrands(), loadEstablishments()])
    })()
    return () => { cancelled = true }
  }, [loadBrands, loadEstablishments])

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

  return (
    <div className="mx-auto max-w-lg px-5 pb-24 pt-4 md:max-w-2xl">
      {/* Back link — single anchor to the source of truth (the hub list). */}
      <Link
        href="/dashboard/establishments"
        className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-grubano-ink-muted transition-colors hover:text-grubano-primary"
      >
        <ArrowLeft size={13} className="rtl:rotate-180" />
        {t('backToHub')}
      </Link>

      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-grubano-ink">
          {t('pageTitleCreate')}
        </h1>
        <p className="mt-1 text-sm text-grubano-ink-muted">
          {t('pageDescCreate')}
        </p>
      </header>

      {/* Mode toggle ─────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { setError(''); setCreateMode('scratch') }}
          className={`flex items-center justify-center gap-1.5 rounded-grubano-md border px-3 py-2.5 text-grubano-sm font-semibold transition ${
            createMode === 'scratch'
              ? 'border-grubano-primary bg-grubano-tint text-grubano-primary'
              : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted'
          }`}
        >
          <Plus size={14} /> {t('copyModeScratch')}
        </button>
        <button
          type="button"
          onClick={() => { setError(''); setCreateMode('copy') }}
          disabled={brands.length === 0}
          className={`flex items-center justify-center gap-1.5 rounded-grubano-md border px-3 py-2.5 text-grubano-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            createMode === 'copy'
              ? 'border-grubano-primary bg-grubano-tint text-grubano-primary'
              : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted'
          }`}
        >
          <Copy size={14} /> {t('copyModeCopy')}
        </button>
      </div>

      <div className="rounded-grubano-lg border border-grubano-border bg-grubano-surface p-5">
        {error && (
          <div className="mb-4 rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
            {error}
          </div>
        )}
        {done && (
          <div className="mb-4 flex items-center gap-2 rounded-grubano-md border border-grubano-success/30 bg-grubano-success-tint px-3 py-2.5 text-grubano-sm text-grubano-success">
            <Check size={15} /> {t('create')} ✓
          </div>
        )}

        {createMode === 'scratch' ? (
          <form onSubmit={submitScratch} className="space-y-4">
            <Input
              label={t('fieldName')}
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('fieldNamePlaceholder')}
            />

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{t('fieldCuisine')}</label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {CUISINE_TYPES.map((c) => {
                  const active = form.cuisineType === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setForm({ ...form, cuisineType: c.value })}
                      className={`flex flex-col items-center gap-1 rounded-grubano-md border px-2 py-2 text-xs font-semibold transition active:scale-95 ${
                        active ? 'border-grubano-primary bg-grubano-tint text-grubano-primary' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted'
                      }`}
                    >
                      <span className="text-lg">{c.emoji}</span>
                      <span>{t(`cuisine_${c.value}` as 'cuisine_italien')}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{t('fieldEmoji')}</label>
              <div className="flex flex-wrap gap-2">
                {BRAND_EMOJIS.map((e2) => (
                  <button
                    key={e2}
                    type="button"
                    onClick={() => setForm({ ...form, emoji: e2 })}
                    aria-label={e2}
                    className={`flex h-10 w-10 items-center justify-center rounded-grubano-md border text-lg transition active:scale-95 ${
                      form.emoji === e2 ? 'border-grubano-primary bg-grubano-tint' : 'border-grubano-border bg-grubano-surface'
                    }`}
                  >
                    {e2}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label={t('fieldTagline')}
              value={form.tagline}
              maxLength={140}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              placeholder={t('fieldTaglinePlaceholder')}
            />

            <div className="pt-1">
              <Button type="submit" variant="primary" size="md" loading={saving} fullWidth>
                {t('create')}
              </Button>
            </div>
          </form>
        ) : (
          // ── COPY MODE ─────────────────────────────────────────────────────
          brands.length === 0 ? (
            <p className="rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-4 text-center text-grubano-sm text-grubano-ink-muted">
              {t('copyNoBrands')}
            </p>
          ) : (
            <form onSubmit={submitCopy} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{t('copySourceLabel')}</label>
                <select
                  value={copySource}
                  onChange={(e) => setCopySource(e.target.value)}
                  className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-grubano-sm text-grubano-ink outline-none transition focus:border-grubano-primary"
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{t('copyTargetLabel')}</label>
                <select
                  value={copyTarget}
                  onChange={(e) => setCopyTarget(e.target.value)}
                  className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-grubano-sm text-grubano-ink outline-none transition focus:border-grubano-primary"
                >
                  {establishments.length === 0 && <option value="">—</option>}
                  {establishments.map((es) => (
                    <option key={es.id} value={es.id}>
                      {es.name}{es.city ? ` · ${es.city}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-start gap-2 rounded-grubano-md border border-grubano-info/30 bg-grubano-info-tint px-3 py-2.5 text-grubano-sm text-grubano-ink-muted">
                <Copy size={15} className="mt-0.5 shrink-0 text-grubano-info" />
                <span>{t('copyHint')}</span>
              </div>

              <div className="pt-1">
                <Button type="submit" variant="primary" size="md" loading={copying} disabled={!copyTarget} fullWidth>
                  {t('copyButton')}
                </Button>
              </div>
            </form>
          )
        )}
      </div>

      {/* ── Re-adoption follow-up (city-exclusive creator dishes) ──────────── */}
      {readopt && (
        <div className="mt-6 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-5">
          <h2 className="mb-2 font-display text-base font-semibold text-grubano-ink">{t('readoptTitle')}</h2>
          <p className="mb-3 text-grubano-sm leading-relaxed text-grubano-ink-muted">
            {t('readoptIntro')}
          </p>
          <ul className="space-y-2">
            {readopt.items.map((it, idx) => (
              <li
                key={it.creatorDishId}
                className="flex items-center gap-3 rounded-grubano-md border border-grubano-border bg-grubano-surface p-3"
              >
                <Sparkles size={15} className="shrink-0 text-grubano-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-grubano-sm font-semibold text-grubano-ink">{it.name}</p>
                  <p className="text-[11px] text-grubano-ink-muted">€{it.sellingPrice.toFixed(2)}</p>
                </div>
                {it.status === 'done' ? (
                  <span className="inline-flex items-center gap-1 text-grubano-sm font-semibold text-grubano-success">
                    <Check size={14} /> {t('readoptDone')}
                  </span>
                ) : it.status === 'taken' ? (
                  <span className="inline-flex items-center gap-1 text-right text-[11px] font-semibold text-grubano-warning">
                    <AlertTriangle size={13} /> {t('readoptCityTaken')}
                  </span>
                ) : it.status === 'error' ? (
                  <button
                    type="button"
                    onClick={() => readoptOne(idx)}
                    className="text-[11px] font-semibold text-grubano-danger underline"
                  >
                    {t('readoptError')}
                  </button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={it.status === 'loading'}
                    onClick={() => readoptOne(idx)}
                  >
                    {t('readoptBtn')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="primary" size="md" onClick={closeReadopt}>
              {t('readoptClose')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function BrandsCreatePage() {
  // useSearchParams() (read in BrandsCreateInner) requires a Suspense boundary in
  // the Next.js 14 App Router, or the build fails with a CSR-bailout error.
  return (
    <Suspense fallback={null}>
      <BrandsCreateInner />
    </Suspense>
  )
}
