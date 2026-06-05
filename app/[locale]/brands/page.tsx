'use client'

import { Link } from '@/navigation'
import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Store, Plus, UtensilsCrossed, Sparkles, TrendingUp, Filter, Lock, Loader2, Pencil, Trash2, Copy, Check, Building2, AlertTriangle } from 'lucide-react'
import { Modal, Button, Input } from '@/components/design-system'

type BrandSummary = {
  id:               string
  name:             string
  emoji:            string
  platform:         string
  status:           string
  menuCount:        number
  adoptedDishCount: number
}

type Performance = {
  windowDays:  number
  caBrut:      number
  ordersTotal: number
}

type SortKey  = 'most' | 'least'
type Platform = 'grubano' | 'all'

// Brand.status defaults to "active"; anything else (e.g. "paused") is treated as
// not-active. We never invent a status — we read Brand.status as stored.
const isActive = (s: string) => s === 'active'

// Soft tile tints, cycled by index so brands stay visually distinct without
// inventing per-brand data.
const TILE_BG = ['bg-orange-50', 'bg-blue-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50', 'bg-pink-50'] as const

// Canonical cuisine values shared with the onboarding flow — labels are i18n.
const CUISINE_TYPES = [
  { value: 'italien', emoji: '🍕' },
  { value: 'asiatique', emoji: '🍜' },
  { value: 'burger', emoji: '🍔' },
  { value: 'healthy', emoji: '🥗' },
  { value: 'sushi', emoji: '🍣' },
  { value: 'desserts', emoji: '🍰' },
  { value: 'wraps', emoji: '🥙' },
  { value: 'pasta', emoji: '🍝' },
  { value: 'autre', emoji: '🍴' },
] as const
const BRAND_EMOJIS = ['🍕', '🍜', '🍔', '🥗', '🍣', '🍰', '🥙', '🍝', '🌮', '🍱', '🥘', '🥟', '🍴', '🥐']

interface BrandForm {
  id?: string
  name: string
  emoji: string
  cuisineType: string
  tagline: string
}

type EstablishmentLite = { id: string; name: string; city: string; isActive: boolean }

type ReadoptStatus = 'idle' | 'loading' | 'done' | 'taken' | 'error'
interface ReadoptItem { creatorDishId: string; name: string; sellingPrice: number; status: ReadoptStatus }
interface ReadoptState { brandId: string; items: ReadoptItem[] }

export default function BrandsPage() {
  const t = useTranslations('brands')

  const [loading, setLoading]   = useState(true)
  const [brands, setBrands]     = useState<BrandSummary[]>([])
  const [perf, setPerf]         = useState<Performance>({ windowDays: 30, caBrut: 0, ordersTotal: 0 })

  const [platform, setPlatform] = useState<Platform>('grubano')
  const [status,   setStatus]   = useState<'all' | 'active' | 'paused'>('all')
  const [sort,     setSort]     = useState<SortKey>('most')

  // Create / edit / delete modal state.
  const [form, setForm]               = useState<BrandForm | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [formError, setFormError]     = useState('')
  const [toDelete, setToDelete]       = useState<BrandSummary | null>(null)
  const [deleting, setDeleting]       = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Establishments (for the copy-target picker + scratch attachment).
  const [establishments, setEstablishments] = useState<EstablishmentLite[]>([])
  const [currentEstablishmentId, setCurrentEstablishmentId] = useState<string | null>(null)

  // Create-mode toggle + copy-brand state.
  const [createMode, setCreateMode] = useState<'scratch' | 'copy'>('scratch')
  const [copySource, setCopySource] = useState('')
  const [copyTarget, setCopyTarget] = useState('')
  const [copying, setCopying]       = useState(false)

  // Re-adoption follow-up (adopted dishes excluded from the copy).
  const [readopt, setReadopt] = useState<ReadoptState | null>(null)

  const loadBrands = useCallback(async () => {
    try {
      const res  = await fetch('/api/brands/summary', { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data?.brands)) setBrands(data.brands)
      if (data?.performance) setPerf(data.performance)
    } catch {
      // Degrade silently to the empty state — never break the page.
    } finally {
      setLoading(false)
    }
  }, [])

  const loadEstablishments = useCallback(async () => {
    try {
      const res  = await fetch('/api/establishments', { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data?.establishments)) setEstablishments(data.establishments)
      if (typeof data?.currentId === 'string') setCurrentEstablishmentId(data.currentId)
    } catch {
      // Non-fatal — copy-target picker just falls back to no establishments.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!cancelled) await Promise.all([loadBrands(), loadEstablishments()])
    })()
    return () => { cancelled = true }
  }, [loadBrands, loadEstablishments])

  function openCreate() {
    setFormError('')
    setCreateMode('scratch')
    setCopySource(brands[0]?.id ?? '')
    setCopyTarget(currentEstablishmentId ?? establishments[0]?.id ?? '')
    setForm({ name: '', emoji: '🍕', cuisineType: 'italien', tagline: '' })
  }

  async function openEdit(b: BrandSummary) {
    setFormError('')
    setForm({ id: b.id, name: b.name, emoji: b.emoji, cuisineType: 'autre', tagline: '' })
    setFormLoading(true)
    try {
      const res = await fetch(`/api/brands/${b.id}`, { cache: 'no-store' })
      const data = await res.json()
      if (res.ok && data?.brand) {
        setForm({
          id: data.brand.id,
          name: data.brand.name ?? b.name,
          emoji: data.brand.emoji ?? b.emoji,
          cuisineType: data.brand.cuisineType ?? 'autre',
          tagline: data.brand.tagline ?? '',
        })
      }
    } catch {
      /* keep the summary-derived defaults */
    } finally {
      setFormLoading(false)
    }
  }

  async function saveForm(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.name.trim()) {
      setFormError(t('errName'))
      return
    }
    setFormError('')
    setSaving(true)
    try {
      const isEdit = Boolean(form.id)
      const res = await fetch(isEdit ? `/api/brands/${form.id}` : '/api/brands', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        form.name.trim(),
          emoji:       form.emoji,
          cuisineType: form.cuisineType,
          tagline:     form.tagline.trim() || null,
          // New scratch brands attach to the active establishment (if any), so the
          // hierarchy établissement → marques holds. Edits never touch the link.
          ...(isEdit ? {} : { restaurantId: (currentEstablishmentId ?? establishments[0]?.id) || undefined }),
        }),
      })
      if (res.status === 401) { window.location.href = '/business/auth'; return }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setFormError((data && (data.error as string)) || t('errSaveFailed'))
        return
      }
      setForm(null)
      await loadBrands()
    } catch {
      setFormError(t('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  // ── Copy an existing brand (with its menu) into a target establishment ───────
  async function submitCopy(e: React.FormEvent) {
    e.preventDefault()
    if (!copySource) { setFormError(t('copyNoBrands')); return }
    if (!copyTarget) { setFormError(t('copyNoTarget')); return }
    setFormError('')
    setCopying(true)
    try {
      const res = await fetch('/api/brands/copy', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceBrandId: copySource, targetRestaurantId: copyTarget }),
      })
      if (res.status === 401) { window.location.href = '/business/auth'; return }
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.brand?.id) {
        setFormError((data && (data.error as string)) || t('copyErrorFailed'))
        return
      }
      setForm(null)
      await loadBrands()
      // If adopted dishes were excluded, offer to re-adopt them in the new city.
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
      }
    } catch {
      setFormError(t('errNetwork'))
    } finally {
      setCopying(false)
    }
  }

  // ── Re-adopt one excluded creator recipe into the freshly-copied brand ───────
  // Re-runs POST /api/dishes/adopt, which re-checks city exclusivity (levier 3)
  // and returns city_taken (409) when the city is already locked elsewhere.
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
        res.ok                                              ? 'done'
        : res.status === 409 && data?.reason === 'city_taken' ? 'taken'
        :                                                     'error'
      setReadopt((r) => r && { ...r, items: r.items.map((it, i) => i === idx ? { ...it, status } : it) })
      if (status === 'done') await loadBrands()
    } catch {
      setReadopt((r) => r && { ...r, items: r.items.map((it, i) => i === idx ? { ...it, status: 'error' } : it) })
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleteError('')
    setDeleting(true)
    try {
      const res = await fetch(`/api/brands/${toDelete.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (res.status === 401) { window.location.href = '/business/auth'; return }
      if (!res.ok) {
        const reason = data?.reason as string | undefined
        setDeleteError(
          reason === 'has_menu_items'              ? t('errDeleteMenu')
          : reason === 'last_brand_active_restaurant' ? t('errDeleteLastBrand')
          : reason === 'has_related_data'          ? t('errDeleteRelated')
          : (data?.error as string) || t('errDeleteFailed'),
        )
        return
      }
      setToDelete(null)
      await loadBrands()
    } catch {
      setDeleteError(t('errNetwork'))
    } finally {
      setDeleting(false)
    }
  }

  const activeCount = brands.filter(b => isActive(b.status)).length

  const filtered = [...brands]
    .filter(b => {
      if (status === 'all')    return true
      if (status === 'active') return isActive(b.status)
      return !isActive(b.status)
    })
    .sort((a, b) => sort === 'most' ? b.menuCount - a.menuCount : a.menuCount - b.menuCount)

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">{t('title')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('conceptsActive', { count: activeCount })}</p>

      {/* Performance globale — operator-level, NOT split per brand (honest). */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={15} className="text-primary" />
          <div>
            <h2 className="text-sm font-bold leading-tight">{t('perfTitle')}</h2>
            <p className="text-[10px] text-muted-foreground">{t('perfSubtitle')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/30 p-3">
            <p className="text-lg font-bold text-foreground">€{perf.caBrut.toLocaleString('fr-FR')}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('perfRevenue')}</p>
          </div>
          <div className="rounded-xl bg-muted/30 p-3">
            <p className="text-lg font-bold text-foreground">{perf.ordersTotal}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('perfOrders')}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        <button
          onClick={() => setPlatform('grubano')}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            platform === 'grubano' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
          }`}
        >
          {t('filterGrubano')}
        </button>
        <button
          onClick={() => setPlatform('all')}
          className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
            platform === 'all' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'
          }`}
        >
          <Lock size={9} /> {t('filterAllPlatforms')}
        </button>
        <span className="mx-1 h-3 w-px bg-border" />
        {([['all', t('statusAll')], ['active', t('statusActive')], ['paused', t('statusPaused')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k as 'all' | 'active' | 'paused')}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              status === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        {([['most', t('sortMost')], ['least', t('sortLeast')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSort(k as SortKey)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              sort === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {platform === 'all' && (
        <Link href="/premium" className="mb-3 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3">
          <Lock size={14} className="text-primary" />
          <p className="flex-1 text-[11px] font-semibold">{t('proBanner')}</p>
          <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">{t('proPrice')}</span>
        </Link>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> {t('loading')}
        </div>
      )}

      {/* Empty: no brands at all */}
      {!loading && brands.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card py-12 text-center">
          <Store size={28} className="text-muted-foreground" />
          <p className="text-sm font-bold">{t('emptyTitle')}</p>
          <p className="max-w-xs text-xs text-muted-foreground">{t('emptyDesc')}</p>
        </div>
      )}

      {/* Empty: brands exist but the filter excludes them all */}
      {!loading && brands.length > 0 && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">
          {t('emptyFiltered')}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((b, i) => (
            <article key={b.id} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-3 p-4">
                <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-2xl ${TILE_BG[i % TILE_BG.length]}`}>
                  {b.emoji}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold">{b.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      isActive(b.status) ? 'bg-success/15 text-success' : 'bg-warning/20 text-warning'
                    }`}>
                      {isActive(b.status) ? t('badgeActive') : t('badgePaused')}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t('brandKind')}</p>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openEdit(b)}
                    aria-label={t('editBrand')}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => { setDeleteError(''); setToDelete(b) }}
                    aria-label={t('deleteBrand')}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-destructive hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-border border-t border-border bg-muted/30">
                <Stat icon={UtensilsCrossed} label={t('statMenu')}     value={String(b.menuCount)} />
                <Stat icon={Sparkles}        label={t('statAdopted')}  value={String(b.adoptedDishCount)} />
              </div>
            </article>
          ))}
        </div>
      )}

      <button
        onClick={openCreate}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card py-4 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
      >
        <Plus size={16} /> {t('addBrand')}
      </button>

      {/* ── Create / Edit modal ─────────────────────────────────────────── */}
      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        size="md"
        title={form?.id ? t('editTitle') : t('createTitle')}
      >
        {form && (
          <form
            onSubmit={(e) => (!form.id && createMode === 'copy' ? submitCopy(e) : saveForm(e))}
            className="space-y-4"
          >
            {formError && (
              <div className="rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
                {formError}
              </div>
            )}

            {/* Mode toggle — presented when ADDING a brand (not editing). */}
            {!form.id && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setFormError(''); setCreateMode('scratch') }}
                  className={`flex items-center justify-center gap-1.5 rounded-grubano-md border px-3 py-2 text-grubano-sm font-semibold transition ${
                    createMode === 'scratch' ? 'border-grubano-primary bg-grubano-tint text-grubano-primary' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted'
                  }`}
                >
                  <Plus size={14} /> {t('copyModeScratch')}
                </button>
                <button
                  type="button"
                  onClick={() => { setFormError(''); setCreateMode('copy') }}
                  className={`flex items-center justify-center gap-1.5 rounded-grubano-md border px-3 py-2 text-grubano-sm font-semibold transition ${
                    createMode === 'copy' ? 'border-grubano-primary bg-grubano-tint text-grubano-primary' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted'
                  }`}
                >
                  <Copy size={14} /> {t('copyModeCopy')}
                </button>
              </div>
            )}

            {/* ── SCRATCH / EDIT fields ─────────────────────────────────── */}
            {(form.id || createMode === 'scratch') && (
            <>
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
            </>
            )}

            {/* ── COPY fields ───────────────────────────────────────────── */}
            {!form.id && createMode === 'copy' && (
              brands.length === 0 ? (
                <p className="rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-4 text-center text-grubano-sm text-grubano-ink-muted">
                  {t('copyNoBrands')}
                </p>
              ) : (
                <>
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
                </>
              )
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" size="md" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={saving || formLoading || copying}
                disabled={!form.id && createMode === 'copy' && (brands.length === 0 || !copyTarget)}
                className="flex-1"
              >
                {form.id ? t('save') : createMode === 'copy' ? t('copyButton') : t('create')}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Re-adoption follow-up modal (excluded creator recipes) ──────── */}
      <Modal
        open={readopt !== null}
        onClose={() => setReadopt(null)}
        size="md"
        title={t('readoptTitle')}
      >
        {readopt && (
          <div className="space-y-4">
            <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">
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
            <div className="flex justify-end pt-1">
              <Button type="button" variant="primary" size="md" onClick={() => setReadopt(null)}>
                {t('readoptClose')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete confirmation modal ───────────────────────────────────── */}
      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        size="sm"
        title={t('deleteConfirmTitle')}
      >
        {toDelete && (
          <div className="space-y-4">
            <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">
              {t('deleteConfirmBody', { name: toDelete.name })}
            </p>
            {toDelete.menuCount > 0 && (
              <div className="rounded-grubano-md border border-grubano-warning/30 bg-grubano-warning-tint px-3 py-2.5 text-grubano-sm text-grubano-ink-muted">
                {t('deleteWarnMenu', { count: toDelete.menuCount })}
              </div>
            )}
            {deleteError && (
              <div className="rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
                {deleteError}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="md" onClick={() => setToDelete(null)}>
                {t('cancel')}
              </Button>
              <Button type="button" variant="danger" size="md" loading={deleting} className="flex-1" onClick={confirmDelete}>
                {t('confirmDelete')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-2 py-3">
      <Icon size={12} className="text-muted-foreground" />
      <p className="text-sm font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}
