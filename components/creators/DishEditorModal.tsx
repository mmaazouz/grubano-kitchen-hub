'use client'

import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  X, Loader2, AlertCircle, Camera, Lock, Save, Send, ChevronDown, ChevronUp,
  Plus, Trash2, ArrowUp, ArrowDown, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/design-system'
import FoodImage from '@/components/eat/FoodImage'
import { getFoodImage, inferCategory } from '@/lib/food-images'
import {
  INCO_ALLERGENS, DIFFICULTIES, sheetCompleteness, estimatedMarginPct,
  hasAllergenDeclaration,
  type DishSheet, type SheetIngredient, type AllergenChoice, type Difficulty,
} from '@/lib/dish-sheet'
import { suggestAllergens } from '@/lib/allergen-suggest'

// ── <DishEditorModal /> — create & edit a recipe (Mission 3 + Mission 6) ──────
//
// ONE component for both modes:
//   create → POST /api/creators/dishes { ..., sheet?, saveAsDraft }
//   edit   → PATCH /api/creators/dishes/[id] (content + sheet; photo travels)
// Mission 6: the editor is organised in 4 COLLAPSIBLE sections so the chef is
// never frightened by the full technical sheet at once:
//   ① base info (M3 fields + photo) · ② technical sheet (servings, quantified
//   ingredients, ordered steps, timings, difficulty, equipment, plating) with
//   the 14-INCO allergen chips + auto-suggestions (suggestAllergens — the chef
//   confirms) · ③ story & diets · ④ business (cost + live margin preview).
// A completeness gauge heads the modal (D3 — a score, never a blocker).
// D2: submission without an allergen declaration → clear error on section ②.
// CONTENT LOCK (R3/D4): an active adoption disables content AND sheet — photo
// stays free.

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
  sheet?:          DishSheet | null
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // mirror of lib/dish-photo MAX_IMAGE_BYTES

type IngredientRow = { name: string; qty: string; unit: string }

const num = (s: string): number | undefined => {
  const n = Number(String(s).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && s.trim() !== '' ? n : undefined
}

// Module-scope (NOT inline in the modal) so its identity is stable across
// renders — an inline definition would remount the subtree and drop the input
// focus at every keystroke.
function Section({
  isOpen, onToggle, title, children,
}: {
  isOpen:   boolean
  onToggle: () => void
  title:    string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-grubano-lg border border-grubano-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-[13px] font-bold text-grubano-ink"
      >
        {title}
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {isOpen && <div className="space-y-3 border-t border-grubano-border p-3">{children}</div>}
    </div>
  )
}

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
  const ta = useTranslations('creators.allergens')
  const td = useTranslations('creators.difficulty')

  const locked = dish?.hasActiveAdoption === true
  const s0 = dish?.sheet ?? null

  // ── ① base info state (M3) ─────────────────────────────────────────────────
  const [name,        setName]        = useState(dish?.name ?? '')
  const [description, setDescription] = useState(dish?.description ?? '')
  const [ingredientsRaw, setIngredientsRaw] = useState((dish?.ingredients ?? []).join(', '))
  const [cuisineType, setCuisineType] = useState(dish?.cuisineType ?? '')
  const [price,       setPrice]       = useState(dish?.suggestedPrice != null ? String(dish.suggestedPrice) : '')
  const [photo,       setPhoto]       = useState<string | null>(dish?.photo ?? null)
  const [photoDirty,  setPhotoDirty]  = useState(false)

  // ── ② technical sheet state (M6) ───────────────────────────────────────────
  const [baseServings, setBaseServings] = useState(s0?.baseServings != null ? String(s0.baseServings) : '')
  const [prepMinutes,  setPrepMinutes]  = useState(s0?.prepMinutes  != null ? String(s0.prepMinutes)  : '')
  const [cookMinutes,  setCookMinutes]  = useState(s0?.cookMinutes  != null ? String(s0.cookMinutes)  : '')
  const [difficulty,   setDifficulty]   = useState<Difficulty | ''>(s0?.difficulty ?? '')
  const [rows, setRows] = useState<IngredientRow[]>(
    (s0?.ingredients ?? []).map((i) => ({ name: i.name, qty: i.qty != null ? String(i.qty) : '', unit: i.unit }))
  )
  const [steps,     setSteps]     = useState<string[]>(s0?.steps ?? [])
  const [allergens, setAllergens] = useState<AllergenChoice[]>(s0?.allergens ?? [])
  const [equipmentRaw, setEquipmentRaw] = useState((s0?.equipment ?? []).join(', '))
  const [platingNotes, setPlatingNotes] = useState(s0?.platingNotes ?? '')

  // ── ③ story & diets / ④ business state ─────────────────────────────────────
  const [story,       setStory]       = useState(s0?.story ?? '')
  const [dietTagsRaw, setDietTagsRaw] = useState((s0?.dietTags ?? []).join(', '))
  const [cost,        setCost]        = useState(s0?.estimatedCostPerServing != null ? String(s0.estimatedCostPerServing) : '')

  // Collapsible sections — base open; tech opens when a sheet already exists.
  const [open, setOpen] = useState({ base: true, tech: Boolean(s0), story: false, biz: false })

  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState<'draft' | 'submit' | 'save' | null>(null)
  const [error,     setError]     = useState('')
  const [warnings,  setWarnings]  = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const previewPhoto = photo
    || (name ? getFoodImage(inferCategory(cuisineType || name), dish?.id ?? name) : null)

  // ── Live sheet build + completeness + suggestions ──────────────────────────
  function buildSheet(): DishSheet | undefined {
    const sheet: DishSheet = {}
    if (num(baseServings) !== undefined && num(baseServings)! > 0) sheet.baseServings = num(baseServings)
    if (num(prepMinutes)  !== undefined) sheet.prepMinutes = num(prepMinutes)
    if (num(cookMinutes)  !== undefined) sheet.cookMinutes = num(cookMinutes)
    if (difficulty) sheet.difficulty = difficulty
    const ing: SheetIngredient[] = rows
      .filter((r) => r.name.trim() !== '')
      .map((r) => ({ name: r.name.trim(), qty: num(r.qty) !== undefined && num(r.qty)! > 0 ? num(r.qty)! : null, unit: r.unit.trim() }))
    if (ing.length) sheet.ingredients = ing
    const st = steps.map((x) => x.trim()).filter(Boolean)
    if (st.length) sheet.steps = st
    if (allergens.length) sheet.allergens = allergens
    const diet = dietTagsRaw.split(',').map((x) => x.trim()).filter(Boolean)
    if (diet.length) sheet.dietTags = diet
    const equip = equipmentRaw.split(',').map((x) => x.trim()).filter(Boolean)
    if (equip.length) sheet.equipment = equip
    if (platingNotes.trim()) sheet.platingNotes = platingNotes.trim()
    if (story.trim()) sheet.story = story.trim()
    if (num(cost) !== undefined) sheet.estimatedCostPerServing = num(cost)
    return Object.keys(sheet).length ? sheet : undefined
  }

  const liveSheet = buildSheet() ?? null
  const completeness = sheetCompleteness(liveSheet)
  const marginPct = estimatedMarginPct(liveSheet, Number(price))

  // Allergen suggestions from BOTH ingredient sources (chef confirms by tap).
  const suggested = useMemo(() => {
    const names = [
      ...rows.map((r) => r.name),
      ...ingredientsRaw.split(',').map((x) => x.trim()),
    ].filter(Boolean)
    return suggestAllergens(names)
  }, [rows, ingredientsRaw])

  function toggleAllergen(id: AllergenChoice) {
    setAllergens((prev) => {
      if (id === 'none') return prev.includes('none') ? [] : ['none']
      const without = prev.filter((a) => a !== 'none')
      return without.includes(id) ? without.filter((a) => a !== id) : [...without, id]
    })
  }

  // What's missing — the top hints under the gauge (max 3, D3: informative only).
  const missing: string[] = []
  if (!liveSheet?.ingredients?.length || liveSheet.ingredients.some((i) => i.qty == null || !i.unit)) missing.push(t('missIngredients'))
  if ((liveSheet?.steps?.length ?? 0) < 2) missing.push(t('missSteps'))
  if (!hasAllergenDeclaration(liveSheet)) missing.push(t('missAllergens'))
  if (liveSheet?.prepMinutes == null || liveSheet?.cookMinutes == null) missing.push(t('missTimings'))
  if (liveSheet?.estimatedCostPerServing == null) missing.push(t('missCost'))

  // ── Photo upload (M3 route — same limits as the restaurant chain) ──────────
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

  function validate(mode: 'draft' | 'submit' | 'save'): boolean {
    if (locked) return true // photo-only save
    const p = contentPayload()
    if (p.name.length < 2)           { setError(t('errName')); setOpen((o) => ({ ...o, base: true })); return false }
    if (p.description.length < 10)   { setError(t('errDescription')); setOpen((o) => ({ ...o, base: true })); return false }
    if (p.ingredients.length === 0)  { setError(t('errIngredients')); setOpen((o) => ({ ...o, base: true })); return false }
    if (!p.cuisineType)              { setError(t('errCuisine')); setOpen((o) => ({ ...o, base: true })); return false }
    if (!Number.isFinite(p.suggestedPrice) || p.suggestedPrice <= 0) { setError(t('errPrice')); setOpen((o) => ({ ...o, base: true })); return false }
    // D2 — allergens are mandatory to SUBMIT (the server re-enforces).
    if (mode === 'submit' && !hasAllergenDeclaration(buildSheet() ?? null)) {
      setError(t('errAllergens'))
      setOpen((o) => ({ ...o, tech: true }))
      return false
    }
    return true
  }

  async function save(mode: 'draft' | 'submit' | 'save') {
    if (saving || uploading) return
    setError('')
    if (!validate(mode)) return
    setSaving(mode)
    try {
      const sheet = buildSheet()
      let res: Response
      if (!dish?.id) {
        // CREATE — draft or direct submission.
        res = await fetch('/api/creators/dishes', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...contentPayload(),
            ...(photo ? { photo } : {}),
            ...(sheet ? { sheet } : {}),
            saveAsDraft: mode === 'draft',
          }),
        })
      } else {
        // EDIT — locked → photo only (D4: the sheet is locked content too).
        res = await fetch(`/api/creators/dishes/${dish.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(locked ? {} : contentPayload()),
            ...(locked ? {} : sheet !== undefined ? { sheet } : {}),
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
  const smallCls = 'rounded-grubano-lg border border-grubano-border bg-grubano-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary disabled:opacity-50'
  const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted'

  const toggle = (id: 'base' | 'tech' | 'story' | 'biz') =>
    setOpen((o) => ({ ...o, [id]: !o[id] }))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[94vh] w-full max-w-lg flex-col rounded-t-3xl bg-white sm:rounded-2xl">
        {/* Header */}
        <div className="border-b border-grubano-border p-4">
          <div className="flex items-center justify-between">
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
          {/* Completeness gauge (D3 — informative, never blocking) */}
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-grubano-ink-muted">{t('completeness', { pct: completeness })}</span>
              {missing.length > 0 && completeness < 100 && (
                <span className="text-grubano-ink-faint">{t('missingLabel', { items: missing.slice(0, 3).join(' · ') })}</span>
              )}
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-grubano-surface-muted">
              <div
                className={`h-full rounded-full transition-all ${completeness >= 80 ? 'bg-grubano-success' : 'bg-grubano-primary'}`}
                style={{ width: `${completeness}%` }}
              />
            </div>
          </div>
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
            <label className={labelCls}>{t('photoLabel')}</label>
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

          {/* ① BASE INFO (M3 fields, lock-aware) */}
          <Section isOpen={open.base} onToggle={() => toggle('base')} title={t('sectionBase')}>
            <div>
              <label className={labelCls}>{tf('formDishName')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} maxLength={80}
                placeholder={tf('dishPlaceholder')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{tf('formDescription')}</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} rows={3} maxLength={600}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{tf('formIngredients')}</label>
              <input value={ingredientsRaw} onChange={(e) => setIngredientsRaw(e.target.value)} disabled={locked}
                placeholder={tf('ingredientsPlaceholder')} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{tf('formCuisine')}</label>
                <input value={cuisineType} onChange={(e) => setCuisineType(e.target.value)} disabled={locked} maxLength={40}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{tf('formPrice')}</label>
                <input type="number" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(e.target.value)} disabled={locked}
                  placeholder="12.90" className={inputCls} />
              </div>
            </div>
          </Section>

          {/* ② TECHNICAL SHEET (the licensed asset — never public, D1) */}
          <Section isOpen={open.tech} onToggle={() => toggle('tech')} title={t('sectionTech')}>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>{t('baseServingsLabel')}</label>
                <input type="number" min="1" step="1" value={baseServings} onChange={(e) => setBaseServings(e.target.value)}
                  disabled={locked} placeholder="4" className={`${smallCls} w-full`} />
              </div>
              <div>
                <label className={labelCls}>{t('prepLabel')}</label>
                <input type="number" min="0" step="1" value={prepMinutes} onChange={(e) => setPrepMinutes(e.target.value)}
                  disabled={locked} placeholder="20" className={`${smallCls} w-full`} />
              </div>
              <div>
                <label className={labelCls}>{t('cookLabel')}</label>
                <input type="number" min="0" step="1" value={cookMinutes} onChange={(e) => setCookMinutes(e.target.value)}
                  disabled={locked} placeholder="15" className={`${smallCls} w-full`} />
              </div>
            </div>

            <div>
              <label className={labelCls}>{t('difficultyLabel')}</label>
              <div className="flex gap-1.5">
                {DIFFICULTIES.map((d) => (
                  <button key={d} type="button" disabled={locked}
                    onClick={() => setDifficulty(difficulty === d ? '' : d)}
                    className={`rounded-grubano-pill px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
                      difficulty === d ? 'bg-grubano-primary text-white' : 'bg-grubano-surface-muted text-grubano-ink-muted'
                    }`}>
                    {td(d)}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantified ingredients */}
            <div>
              <label className={labelCls}>{t('sheetIngredientsLabel')}</label>
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input value={r.name} disabled={locked} placeholder={t('ingName')}
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      className={`${smallCls} min-w-0 flex-1`} />
                    <input value={r.qty} disabled={locked} placeholder={t('ingQty')} type="number" min="0" step="any"
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                      className={`${smallCls} w-16`} />
                    <input value={r.unit} disabled={locked} placeholder={t('ingUnit')} maxLength={12}
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}
                      className={`${smallCls} w-16`} />
                    <button type="button" disabled={locked} aria-label={t('removeLine')}
                      onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-grubano-ink-faint disabled:opacity-50">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={locked} leftIcon={<Plus size={12} />}
                className="mt-1.5" onClick={() => setRows((p) => [...p, { name: '', qty: '', unit: '' }])}>
                {t('addIngredient')}
              </Button>
            </div>

            {/* ALLERGENS — the 14 INCO chips + 'none' + auto-suggestions (D2) */}
            <div>
              <label className={labelCls}>{t('allergensLabel')}</label>
              <div className="flex flex-wrap gap-1.5">
                {INCO_ALLERGENS.map((a) => {
                  const checked    = allergens.includes(a)
                  const isSuggested = !checked && suggested.includes(a) && !allergens.includes('none')
                  return (
                    <button key={a} type="button" disabled={locked} onClick={() => toggleAllergen(a)}
                      className={`rounded-grubano-pill px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                        checked
                          ? 'bg-grubano-primary text-white'
                          : isSuggested
                            ? 'border border-dashed border-grubano-primary bg-grubano-tint text-grubano-primary'
                            : 'bg-grubano-surface-muted text-grubano-ink-muted'
                      }`}>
                      {ta(a)}{isSuggested ? ` · ${t('suggestedTag')}` : ''}
                    </button>
                  )
                })}
                <button type="button" disabled={locked} onClick={() => toggleAllergen('none')}
                  className={`rounded-grubano-pill px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                    allergens.includes('none') ? 'bg-grubano-ink text-white' : 'border border-grubano-border bg-white text-grubano-ink-muted'
                  }`}>
                  {ta('none')}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-grubano-ink-faint">{t('allergensHint')}</p>
            </div>

            {/* Ordered steps */}
            <div>
              <label className={labelCls}>{t('stepsLabel')}</label>
              <div className="space-y-1.5">
                {steps.map((st, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="mt-2 w-5 shrink-0 text-center text-[11px] font-bold text-grubano-primary">{i + 1}.</span>
                    <textarea value={st} disabled={locked} rows={2} placeholder={t('stepPlaceholder')}
                      onChange={(e) => setSteps((p) => p.map((x, j) => j === i ? e.target.value : x))}
                      className={`${smallCls} min-w-0 flex-1`} />
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button type="button" disabled={locked || i === 0} aria-label={t('moveUp')}
                        onClick={() => setSteps((p) => { const c = [...p]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c })}
                        className="grid h-6 w-6 place-items-center rounded text-grubano-ink-faint disabled:opacity-30">
                        <ArrowUp size={12} />
                      </button>
                      <button type="button" disabled={locked || i === steps.length - 1} aria-label={t('moveDown')}
                        onClick={() => setSteps((p) => { const c = [...p]; [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c })}
                        className="grid h-6 w-6 place-items-center rounded text-grubano-ink-faint disabled:opacity-30">
                        <ArrowDown size={12} />
                      </button>
                      <button type="button" disabled={locked} aria-label={t('removeLine')}
                        onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}
                        className="grid h-6 w-6 place-items-center rounded text-grubano-ink-faint disabled:opacity-50">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={locked} leftIcon={<Plus size={12} />}
                className="mt-1.5" onClick={() => setSteps((p) => [...p, ''])}>
                {t('addStep')}
              </Button>
            </div>

            <div>
              <label className={labelCls}>{t('equipmentLabel')}</label>
              <input value={equipmentRaw} onChange={(e) => setEquipmentRaw(e.target.value)} disabled={locked}
                placeholder={t('equipmentPlaceholder')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('platingLabel')}</label>
              <textarea value={platingNotes} onChange={(e) => setPlatingNotes(e.target.value)} disabled={locked} rows={2} maxLength={600}
                className={inputCls} />
            </div>
          </Section>

          {/* ③ STORY & DIETS (the public face) */}
          <Section isOpen={open.story} onToggle={() => toggle('story')} title={t('sectionStory')}>
            <div>
              <label className={labelCls}>{t('storyLabel')}</label>
              <textarea value={story} onChange={(e) => setStory(e.target.value)} disabled={locked} rows={3} maxLength={1000}
                placeholder={t('storyPlaceholder')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('dietTagsLabel')}</label>
              <input value={dietTagsRaw} onChange={(e) => setDietTagsRaw(e.target.value)} disabled={locked}
                placeholder={t('dietTagsPlaceholder')} className={inputCls} />
            </div>
          </Section>

          {/* ④ BUSINESS (cost + live margin preview) */}
          <Section isOpen={open.biz} onToggle={() => toggle('biz')} title={t('sectionBusiness')}>
            <div>
              <label className={labelCls}>{t('costLabel')}</label>
              <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)}
                disabled={locked} placeholder="3.50" className={inputCls} />
              <p className="mt-1 text-[10px] text-grubano-ink-faint">{t('costHint')}</p>
            </div>
            {marginPct !== null && (
              <p className="flex items-center gap-1.5 rounded-grubano-lg bg-grubano-success-tint px-3 py-2 text-[12px] font-semibold text-grubano-success">
                <Sparkles size={13} /> {t('marginPreview', { pct: marginPct })}
              </p>
            )}
          </Section>

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
