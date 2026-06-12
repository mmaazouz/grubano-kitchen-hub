'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X, Loader2, AlertCircle, Camera, Lock, Save, Send } from 'lucide-react'
import { Button } from '@/components/design-system'
import FoodImage from '@/components/eat/FoodImage'
import { getFoodImage, inferCategory } from '@/lib/food-images'

// ── <DishEditorModal /> — create & edit a recipe (Mission 3 editor) ───────────
//
// ONE component for both modes:
//   create → POST /api/creators/dishes { ..., saveAsDraft }
//   edit   → PATCH /api/creators/dishes/[id] (content; photo travels with it)
// Photo upload → POST /api/creators/dishes/photo (the proven lib/dish-photo
// chain: validation → Claude moderation → Cloudinary square URL) → previewed,
// persisted with the save. CONTENT LOCK (R3): when the recipe has an active
// adoption the content fields are disabled behind an explanatory banner — only
// the photo remains editable.

export interface EditableDish {
  id?:             string
  name:            string
  description:     string
  ingredients:     string[]
  cuisineType:     string
  suggestedPrice:  number | null
  photo:           string | null
  status?:         string
  hasActiveAdoption?: boolean
  adoptionsCount?: number
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // mirror of lib/dish-photo MAX_IMAGE_BYTES

export default function DishEditorModal({
  dish, onClose, onSaved,
}: {
  /** null → creation mode. */
  dish:    EditableDish | null
  onClose: () => void
  /** verdict present when a submission ran (approved | pending | rejected). */
  onSaved: (outcome: { verdict?: string; reason?: string }) => void
}) {
  const t  = useTranslations('creators.editor')
  const tf = useTranslations('creators.home') // existing form labels reused

  const locked = dish?.hasActiveAdoption === true

  const [name,        setName]        = useState(dish?.name ?? '')
  const [description, setDescription] = useState(dish?.description ?? '')
  const [ingredientsRaw, setIngredientsRaw] = useState((dish?.ingredients ?? []).join(', '))
  const [cuisineType, setCuisineType] = useState(dish?.cuisineType ?? '')
  const [price,       setPrice]       = useState(dish?.suggestedPrice != null ? String(dish.suggestedPrice) : '')
  const [photo,       setPhoto]       = useState<string | null>(dish?.photo ?? null)
  const [photoDirty,  setPhotoDirty]  = useState(false)

  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState<'draft' | 'submit' | 'save' | null>(null)
  const [error,     setError]     = useState('')
  const [warnings,  setWarnings]  = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const previewPhoto = photo
    || (name ? getFoodImage(inferCategory(cuisineType || name), dish?.id ?? name) : null)

  // ── Photo upload (1.4 route — same limits as the restaurant chain) ─────────
  async function uploadPhoto(file: File) {
    setError('')
    setWarnings([])
    if (file.size > MAX_PHOTO_BYTES) { setError(t('photoTooBig')); return }
    setUploading(true)
    try {
      const buf = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
      }
      const imageBase64 = btoa(binary)
      const r = await fetch('/api/creators/dishes/photo', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64, mediaType: file.type }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.url) {
        setError((body?.error as string) || t('photoError'))
        return
      }
      setPhoto(body.url as string)
      setPhotoDirty(true)
      if (Array.isArray(body.warnings) && body.warnings.length) setWarnings(body.warnings)
    } catch {
      setError(t('photoError'))
    } finally {
      setUploading(false)
    }
  }

  // ── Save paths ──────────────────────────────────────────────────────────────
  function contentPayload() {
    return {
      name:           name.trim(),
      description:    description.trim(),
      ingredients:    ingredientsRaw.split(',').map((s) => s.trim()).filter(Boolean),
      cuisineType:    cuisineType.trim(),
      suggestedPrice: Number(price),
    }
  }

  function validate(): boolean {
    if (locked) return true // photo-only save
    const p = contentPayload()
    if (p.name.length < 2)           { setError(t('errName')); return false }
    if (p.description.length < 10)   { setError(t('errDescription')); return false }
    if (p.ingredients.length === 0)  { setError(t('errIngredients')); return false }
    if (!p.cuisineType)              { setError(t('errCuisine')); return false }
    if (!Number.isFinite(p.suggestedPrice) || p.suggestedPrice <= 0) { setError(t('errPrice')); return false }
    return true
  }

  async function save(mode: 'draft' | 'submit' | 'save') {
    if (saving || uploading) return
    setError('')
    if (!validate()) return
    setSaving(mode)
    try {
      let res: Response
      if (!dish?.id) {
        // CREATE — draft or direct submission.
        res = await fetch('/api/creators/dishes', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...contentPayload(),
            ...(photo ? { photo } : {}),
            saveAsDraft: mode === 'draft',
          }),
        })
      } else {
        // EDIT — locked → photo only; otherwise content (+ photo if changed).
        res = await fetch(`/api/creators/dishes/${dish.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(locked ? {} : contentPayload()),
            ...(photoDirty && photo ? { photo } : {}),
          }),
        })
      }
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body?.error as string) || t('errGeneric'))
        return
      }
      // Edit + explicit submit → run the submit route afterwards.
      if (dish?.id && mode === 'submit') {
        const r2 = await fetch(`/api/creators/dishes/${dish.id}/submit`, { method: 'POST' })
        const b2 = await r2.json().catch(() => null)
        if (!r2.ok) { setError((b2?.error as string) || t('errGeneric')); return }
        onSaved({ verdict: b2?.verdict as string, reason: b2?.reason as string })
        return
      }
      // Create-and-submit → the POST already vetted (status on the dish).
      const verdict = !dish?.id && mode === 'submit'
        ? (body?.dish?.status as string)
        : body?.vetReason !== undefined
          ? (body?.dish?.status as string)
          : undefined
      onSaved({ verdict, reason: body?.vetReason as string | undefined })
    } catch {
      setError(t('errGeneric'))
    } finally {
      setSaving(null)
    }
  }

  const inputCls = 'w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[94vh] w-full max-w-lg flex-col rounded-t-3xl bg-white sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-grubano-border p-4">
          <p className="text-base font-bold text-grubano-ink">
            {dish?.id ? t('editTitle') : t('createTitle')}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="grid h-9 w-9 place-items-center rounded-xl bg-grubano-surface-muted"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {/* R3 — explanatory lock banner */}
          {locked && (
            <p className="flex items-start gap-2 rounded-grubano-lg border border-grubano-warning/40 bg-grubano-warning-tint px-3 py-2.5 text-[12px] text-grubano-ink">
              <Lock size={13} className="mt-0.5 shrink-0 text-grubano-warning" />
              <span>{t('lockedBanner', { count: dish?.adoptionsCount ?? 1 })}</span>
            </p>
          )}

          {/* Photo — ALWAYS editable */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted">
              {t('photoLabel')}
            </label>
            <div className="flex items-center gap-3">
              {previewPhoto ? (
                <FoodImage name={name || 'dish'} src={previewPhoto} className="h-20 w-20 shrink-0 rounded-grubano-lg" glyphClassName="text-2xl" />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-grubano-lg bg-grubano-surface-muted text-grubano-ink-faint">
                  <Camera size={20} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = '' }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                  leftIcon={<Camera size={13} />}
                >
                  {photo ? t('photoReplace') : t('photoAdd')}
                </Button>
                <p className="mt-1 text-[10px] text-grubano-ink-faint">{t('photoHint')}</p>
                {warnings.length > 0 && (
                  <p className="mt-1 text-[10px] text-grubano-warning">{warnings.join(' · ')}</p>
                )}
              </div>
            </div>
          </div>

          {/* Content fields — disabled under an active adoption (R3) */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted">{tf('formDishName')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} maxLength={80}
              placeholder={tf('dishPlaceholder')} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted">{tf('formDescription')}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} rows={3} maxLength={600}
              className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted">{tf('formIngredients')}</label>
            <input value={ingredientsRaw} onChange={(e) => setIngredientsRaw(e.target.value)} disabled={locked}
              placeholder={tf('ingredientsPlaceholder')} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted">{tf('formCuisine')}</label>
              <input value={cuisineType} onChange={(e) => setCuisineType(e.target.value)} disabled={locked} maxLength={40}
                className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted">{tf('formPrice')}</label>
              <input type="number" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(e.target.value)} disabled={locked}
                placeholder="12.90" className={inputCls} />
            </div>
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2 text-[12px] text-grubano-danger">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-2 border-t border-grubano-border p-4">
          {locked ? (
            <Button type="button" variant="primary" size="md" className="flex-1"
              loading={saving !== null} onClick={() => save('save')} leftIcon={<Save size={14} />}>
              {t('savePhoto')}
            </Button>
          ) : dish?.id && dish.status === 'approved' ? (
            // R2 — editing an approved recipe: ONE save path, the server
            // re-vets the changed content automatically.
            <Button type="button" variant="primary" size="md" className="flex-1"
              loading={saving !== null} onClick={() => save('save')} leftIcon={<Save size={14} />}>
              {t('saveRevet')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" size="md" className="flex-1"
                loading={saving === 'draft'} onClick={() => save('draft')} leftIcon={<Save size={14} />}>
                {t('saveDraft')}
              </Button>
              <Button type="button" variant="primary" size="md" className="flex-1"
                loading={saving === 'submit'} onClick={() => save('submit')} leftIcon={<Send size={14} />}>
                {t('submitCta')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
