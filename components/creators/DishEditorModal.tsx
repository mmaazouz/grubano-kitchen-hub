'use client'

import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  INCO_ALLERGENS, DIFFICULTIES, sheetCompleteness, estimatedMarginPct,
  hasAllergenDeclaration,
  type DishSheet, type SheetIngredient, type AllergenChoice, type Difficulty,
} from '@/lib/dish-sheet'
import { suggestAllergens } from '@/lib/allergen-suggest'

// ── <DishEditorModal /> — create & edit a recipe (Mission 3 + Mission 6) ──────
// CR4 RE-SKIN (visual only): CreatorShell --op-/--op-cr language + Material
// Symbols; the ed-* section cards + sticky publish aside from the CD maquette.
// EVERY handler, fetch, payload, validation and section is byte-identical to the
// previous version — including the mandatory 14-INCO allergen declaration (D2,
// re-enforced server-side on submit), the full technical sheet, the completeness
// gauge (D3), and the content-lock-on-active-adoption (R3/D4, photo stays free).
//
// ONE component for both modes:
//   create → POST /api/creators/dishes { ..., sheet?, saveAsDraft }
//   edit   → PATCH /api/creators/dishes/[id] (content + sheet; photo travels)
//   submit → POST /api/creators/dishes/[id]/submit (edit) OR direct in the create POST.
// The editor keeps its 4 COLLAPSIBLE sections so the chef is never frightened by
// the full technical sheet at once. Classes are scoped .gb-op (creator-recipes.css).

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
  isOpen, onToggle, title, icon, children,
}: {
  isOpen:   boolean
  onToggle: () => void
  title:    string
  icon:     string
  children: React.ReactNode
}) {
  return (
    <div className="op-card ed-sec">
      <h3>
        <span className="ms" aria-hidden="true">{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--op-muted)', display: 'inline-flex', margin: '-16px 0' }}
        >
          <span className="ms" aria-hidden="true">{isOpen ? 'expand_less' : 'expand_more'}</span>
        </button>
      </h3>
      {isOpen && children}
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
  onSaved: (outcome: { verdict?: string; reason?: string; signatureScore?: number }) => void
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
        onSaved({ verdict: b2?.verdict as string, reason: b2?.reason as string, signatureScore: b2?.signatureScore as number | undefined })
        return
      }
      // Create-and-submit → the POST already vetted (status on the dish).
      const verdict = !dish?.id && mode === 'submit'
        ? (body?.dish?.status as string)
        : body?.vetReason !== undefined
          ? (body?.dish?.status as string)
          : undefined
      onSaved({ verdict, reason: body?.vetReason as string | undefined, signatureScore: body?.vetSignatureScore as number | undefined })
    } catch {
      setError(t('errGeneric'))
    } finally {
      setSaving(null)
    }
  }

  const toggle = (id: 'base' | 'tech' | 'story' | 'biz') =>
    setOpen((o) => ({ ...o, [id]: !o[id] }))

  const previewPhoto = photo || null
  const isSaving = saving !== null

  // Publish-status descriptor (real 5-state lifecycle). New recipe (no id) → draft.
  const st = dish?.status
  const pubDesc =
    st === 'approved' || st === 'live' ? { cls: 'pub',      ic: 'check_circle', title: t('statusPublished'), sub: t('pubSubPublished') }
    : st === 'pending'                 ? { cls: 'pending',  ic: 'schedule',     title: t('statusInReview'),  sub: t('pubSubPending') }
    : st === 'rejected'                ? { cls: 'rejected', ic: 'error',        title: t('statusRejected'),  sub: t('pubSubRejected') }
    : st === 'archived'                ? { cls: 'draft',    ic: 'archive',      title: t('statusArchived'),  sub: t('pubSubArchived') }
    :                                    { cls: 'draft',    ic: 'edit_note',    title: t('statusDraft'),     sub: t('pubSubDraft') }

  return (
    <div className="ed-scrim" role="dialog" aria-modal="true" aria-label={dish?.id ? t('editTitle') : t('createTitle')}>
      <div className="ed-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ed-head">
          <div className="ed-head__m">
            <h2>{dish?.id ? t('editTitle') : t('createTitle')}</h2>
            {name.trim() && <p>{name.trim()}</p>}
          </div>
          <button type="button" className="ed-close" onClick={onClose} aria-label={t('close')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Completeness gauge (D3 — informative, never blocking) */}
        <div className="ed-gauge">
          <div className="ed-gauge__top">
            <span className="lbl"><span className="ms" aria-hidden="true">insights</span>{t('completenessLabel')}<span className="pct">{completeness}%</span></span>
            {missing.length > 0 && completeness < 100 && (
              <span className="miss">{t('missingLabel', { items: missing.slice(0, 3).join(' · ') })}</span>
            )}
          </div>
          <div className="ed-gauge__bar">
            <div className={`ed-gauge__fill${completeness >= 80 ? ' hi' : ''}`} style={{ width: `${completeness}%` }} />
          </div>
        </div>

        <div className="ed-body">
          {/* R3 — explanatory lock banner */}
          {locked && (
            <div className="ed-lock">
              <span className="ms" aria-hidden="true">lock</span>
              <span>{t('lockedBanner', { count: dish?.adoptionsCount ?? 1 })}</span>
            </div>
          )}

          <div className="ed-cols">
            {/* ── MAIN column (sections) ─────────────────────────────────────── */}
            <div>
              {/* ① BASE INFO (photo + M3 fields, lock-aware) */}
              <Section isOpen={open.base} onToggle={() => toggle('base')} title={t('sectionBase')} icon="image">
                {/* Photo — ALWAYS editable */}
                <div className="fld">
                  <label>{t('photoLabel')}</label>
                  <button
                    type="button"
                    className={`cover-drop${previewPhoto ? ' has-img' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    aria-label={photo ? t('photoReplace') : t('photoAdd')}
                  >
                    {previewPhoto ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewPhoto} alt="" />
                        <div className="cover-drop__over">
                          <span className="ms" aria-hidden="true">{uploading ? 'progress_activity' : 'photo_camera'}</span>
                          <b style={{ color: '#fff' }}>{photo ? t('photoReplace') : t('photoAdd')}</b>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="ms" aria-hidden="true">{uploading ? 'progress_activity' : 'add_photo_alternate'}</span>
                        <b>{photo ? t('photoReplace') : t('photoAdd')}</b>
                        <span>{t('photoHint')}</span>
                      </>
                    )}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = '' }}
                  />
                  {warnings.length > 0 && <p className="cover-warn">{warnings.join(' · ')}</p>}
                </div>

                <div className="fld">
                  <label>{tf('formDishName')}</label>
                  <input className="inp" value={name} onChange={(e) => setName(e.target.value)} disabled={locked} maxLength={80}
                    placeholder={tf('dishPlaceholder')} />
                </div>
                <div className="fld">
                  <label>{tf('formDescription')}</label>
                  <textarea className="inp" value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} rows={3} maxLength={600} />
                </div>
                <div className="fld">
                  <label>{tf('formIngredients')}</label>
                  <input className="inp" value={ingredientsRaw} onChange={(e) => setIngredientsRaw(e.target.value)} disabled={locked}
                    placeholder={tf('ingredientsPlaceholder')} />
                </div>
                <div className="row2">
                  <div className="fld">
                    <label>{tf('formCuisine')}</label>
                    <input className="inp" value={cuisineType} onChange={(e) => setCuisineType(e.target.value)} disabled={locked} maxLength={40} />
                  </div>
                  <div className="fld">
                    <label>{tf('formPrice')}</label>
                    <input className="inp" type="number" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(e.target.value)} disabled={locked}
                      placeholder="12.90" />
                  </div>
                </div>
              </Section>

              {/* ② TECHNICAL SHEET (the licensed asset — never public, D1) */}
              <Section isOpen={open.tech} onToggle={() => toggle('tech')} title={t('sectionTech')} icon="tune">
                <div className="row3">
                  <div className="fld">
                    <label>{t('baseServingsLabel')}</label>
                    <input className="inp" type="number" min="1" step="1" value={baseServings} onChange={(e) => setBaseServings(e.target.value)}
                      disabled={locked} placeholder="4" />
                  </div>
                  <div className="fld">
                    <label>{t('prepLabel')}</label>
                    <input className="inp" type="number" min="0" step="1" value={prepMinutes} onChange={(e) => setPrepMinutes(e.target.value)}
                      disabled={locked} placeholder="20" />
                  </div>
                  <div className="fld">
                    <label>{t('cookLabel')}</label>
                    <input className="inp" type="number" min="0" step="1" value={cookMinutes} onChange={(e) => setCookMinutes(e.target.value)}
                      disabled={locked} placeholder="15" />
                  </div>
                </div>

                <div className="fld">
                  <label>{t('difficultyLabel')}</label>
                  <div className="chips">
                    {DIFFICULTIES.map((d) => (
                      <button key={d} type="button" disabled={locked}
                        onClick={() => setDifficulty(difficulty === d ? '' : d)}
                        className={`chip${difficulty === d ? ' on' : ''}`}>
                        {td(d)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quantified ingredients */}
                <div className="fld">
                  <label>{t('sheetIngredientsLabel')}</label>
                  {rows.map((r, i) => (
                    <div key={i} className="dyn-row">
                      <input className="inp qty" value={r.qty} disabled={locked} placeholder={t('ingQty')} type="number" min="0" step="any"
                        onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                      <input className="inp unit" value={r.unit} disabled={locked} placeholder={t('ingUnit')} maxLength={12}
                        onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                      <input className="inp" value={r.name} disabled={locked} placeholder={t('ingName')}
                        onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <button type="button" className="del" disabled={locked} aria-label={t('removeLine')}
                        onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>
                        <span className="ms" aria-hidden="true">close</span>
                      </button>
                    </div>
                  ))}
                  <button type="button" className="dyn-add" disabled={locked}
                    onClick={() => setRows((p) => [...p, { name: '', qty: '', unit: '' }])}>
                    <span className="ms" aria-hidden="true">add</span>{t('addIngredient')}
                  </button>
                </div>

                {/* ALLERGENS — the 14 INCO chips + 'none' + auto-suggestions (D2) */}
                <div className="fld">
                  <label>{t('allergensLabel')}</label>
                  <div className="chips">
                    {INCO_ALLERGENS.map((a) => {
                      const checked     = allergens.includes(a)
                      const isSuggested = !checked && suggested.includes(a) && !allergens.includes('none')
                      return (
                        <button key={a} type="button" disabled={locked} onClick={() => toggleAllergen(a)}
                          className={`chip${checked ? ' on' : isSuggested ? ' suggested' : ''}`}>
                          {ta(a)}{isSuggested ? ` · ${t('suggestedTag')}` : ''}
                        </button>
                      )
                    })}
                    <button type="button" disabled={locked} onClick={() => toggleAllergen('none')}
                      className={`chip${allergens.includes('none') ? ' none-on' : ''}`}>
                      {ta('none')}
                    </button>
                  </div>
                  <p className="fldhint">{t('allergensHint')}</p>
                </div>

                {/* Ordered steps */}
                <div className="fld">
                  <label>{t('stepsLabel')}</label>
                  {steps.map((step, i) => (
                    <div key={i} className="dyn-row">
                      <span className="num">{i + 1}</span>
                      <textarea className="inp" value={step} disabled={locked} rows={2} placeholder={t('stepPlaceholder')}
                        style={{ minHeight: 56 }}
                        onChange={(e) => setSteps((p) => p.map((x, j) => j === i ? e.target.value : x))} />
                      <div className="moves">
                        <button type="button" disabled={locked || i === 0} aria-label={t('moveUp')}
                          onClick={() => setSteps((p) => { const c = [...p]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c })}>
                          <span className="ms" aria-hidden="true">keyboard_arrow_up</span>
                        </button>
                        <button type="button" disabled={locked || i === steps.length - 1} aria-label={t('moveDown')}
                          onClick={() => setSteps((p) => { const c = [...p]; [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c })}>
                          <span className="ms" aria-hidden="true">keyboard_arrow_down</span>
                        </button>
                      </div>
                      <button type="button" className="del" disabled={locked} aria-label={t('removeLine')}
                        onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}>
                        <span className="ms" aria-hidden="true">close</span>
                      </button>
                    </div>
                  ))}
                  <button type="button" className="dyn-add" disabled={locked}
                    onClick={() => setSteps((p) => [...p, ''])}>
                    <span className="ms" aria-hidden="true">add</span>{t('addStep')}
                  </button>
                </div>

                <div className="fld">
                  <label>{t('equipmentLabel')}</label>
                  <input className="inp" value={equipmentRaw} onChange={(e) => setEquipmentRaw(e.target.value)} disabled={locked}
                    placeholder={t('equipmentPlaceholder')} />
                </div>
                <div className="fld">
                  <label>{t('platingLabel')}</label>
                  <textarea className="inp" value={platingNotes} onChange={(e) => setPlatingNotes(e.target.value)} disabled={locked} rows={2} maxLength={600} />
                </div>
              </Section>

              {/* ③ STORY & DIETS (the public face) */}
              <Section isOpen={open.story} onToggle={() => toggle('story')} title={t('sectionStory')} icon="menu_book">
                <div className="fld">
                  <label>{t('storyLabel')}</label>
                  <textarea className="inp" value={story} onChange={(e) => setStory(e.target.value)} disabled={locked} rows={3} maxLength={1000}
                    placeholder={t('storyPlaceholder')} />
                </div>
                <div className="fld">
                  <label>{t('dietTagsLabel')}</label>
                  <input className="inp" value={dietTagsRaw} onChange={(e) => setDietTagsRaw(e.target.value)} disabled={locked}
                    placeholder={t('dietTagsPlaceholder')} />
                </div>
              </Section>

              {/* ④ BUSINESS (cost + live margin preview) */}
              <Section isOpen={open.biz} onToggle={() => toggle('biz')} title={t('sectionBusiness')} icon="payments">
                <div className="fld">
                  <label>{t('costLabel')}</label>
                  <input className="inp" type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)}
                    disabled={locked} placeholder="3.50" />
                  <p className="fldhint">{t('costHint')}</p>
                </div>
                {marginPct !== null && (
                  <div className="ed-margin">
                    <span className="ms" aria-hidden="true">trending_up</span>{t('marginPreview', { pct: marginPct })}
                  </div>
                )}
              </Section>
            </div>

            {/* ── ASIDE : publish card (sticky) ──────────────────────────────── */}
            <div>
              <div className="op-card ed-sec pub-card">
                <h3><span className="ms" aria-hidden="true">publish</span>{t('pubTitle')}</h3>

                <div className={`pub-status ${pubDesc.cls}`}>
                  <span className="ms" aria-hidden="true">{pubDesc.ic}</span>
                  <div><b>{pubDesc.title}</b><span>{pubDesc.sub}</span></div>
                </div>

                {/* AI hint — INERT (bientôt) */}
                <div className="ai-hint">
                  <span className="ms" aria-hidden="true">auto_awesome</span>
                  <span><span className="soon">{t('aiHintSoon')}</span> {t('aiHintBody')}</span>
                </div>

                {error && (
                  <div className="ed-error" style={{ marginTop: 12 }}>
                    <span className="ms" aria-hidden="true">error</span><span>{error}</span>
                  </div>
                )}

                {/* Footer actions (state-driven, byte-identical logic) */}
                <div className="pub-actions">
                  {locked ? (
                    <button type="button" className="op-btn-primary" disabled={isSaving} onClick={() => save('save')}>
                      <span className={`ms${isSaving ? ' rc-spin' : ''}`} aria-hidden="true">{isSaving ? 'progress_activity' : 'save'}</span>{t('savePhoto')}
                    </button>
                  ) : dish?.id && dish.status === 'approved' ? (
                    // R2 — editing an approved recipe: ONE save path, the server re-vets.
                    <button type="button" className="op-btn-primary" disabled={isSaving} onClick={() => save('save')}>
                      <span className={`ms${isSaving ? ' rc-spin' : ''}`} aria-hidden="true">{isSaving ? 'progress_activity' : 'save'}</span>{t('saveRevet')}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="op-btn-primary" disabled={isSaving} onClick={() => save('submit')}>
                        <span className={`ms${saving === 'submit' ? ' rc-spin' : ''}`} aria-hidden="true">{saving === 'submit' ? 'progress_activity' : 'publish'}</span>{t('submitCta')}
                      </button>
                      <button type="button" className="op-btn-ghost" disabled={isSaving} onClick={() => save('draft')}>
                        <span className={`ms${saving === 'draft' ? ' rc-spin' : ''}`} aria-hidden="true">{saving === 'draft' ? 'progress_activity' : 'save'}</span>{t('saveDraft')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
