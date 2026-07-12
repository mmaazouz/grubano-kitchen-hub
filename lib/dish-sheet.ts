import { z } from 'zod'

// ── Fiche recette de chef — types + pure logic (Mission 6) ──────────────────────
// PURE MODULE (client-safe — the editor imports the score live): the tolerant
// DB readers live in lib/dish-sheet-db.ts (server only).
//
// The recipe becomes a 3-faced licensed product:
//   • PUBLIC face (/chef, catalogue pre-adoption): story, dietTags, timings,
//     difficulty — never anything technical.
//   • EXECUTION face (the technical sheet): quantified ingredients, ordered
//     steps, plating, equipment — the LICENSED ASSET the 2% royalties pay for.
//     Served ONLY to restos with a DishAdoption (active or ended), the creator,
//     or an admin (D1).
//   • BUSINESS face (catalogue card): completeness, estimated cost/margin.
//
// D2: the 14 INCO allergens are MANDATORY to SUBMIT a new recipe ('none' is an
// explicit valid choice). Legacy recipes without a sheet stay valid.
// D3: nothing else is mandatory — completeness is a SCORE, never a blocker.

// The 14 EU INCO mandatory allergens (the French resto's legal duty — Grubano
// handles it at the source).
export const INCO_ALLERGENS = [
  'gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait',
  'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques',
] as const

export type AllergenId = (typeof INCO_ALLERGENS)[number]
/** 'none' = the explicit « Aucun allergène » choice (valid per D2). */
export type AllergenChoice = AllergenId | 'none'

export const DIFFICULTIES = ['facile', 'moyen', 'technique'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export type SheetIngredient = {
  name: string
  qty:  number | null
  unit: string
}

export type DishSheet = {
  /** Reference servings the quantities are written for (scaling base). */
  baseServings?:            number
  prepMinutes?:             number
  cookMinutes?:             number
  difficulty?:              Difficulty
  /** Quantified ingredients — TECHNICAL (never public). */
  ingredients?:             SheetIngredient[]
  /** Ordered steps — TECHNICAL (never public). */
  steps?:                   string[]
  /** D2 — mandatory at submission for new recipes. ['none'] = explicit none. */
  allergens?:               AllergenChoice[]
  /** Public diet tags (végétarien, vegan, halal, sans gluten…). */
  dietTags?:                string[]
  equipment?:               string[]
  /** Plating/dressage notes — TECHNICAL (never public). */
  platingNotes?:            string
  /** The recipe's story — PUBLIC face. */
  story?:                   string
  /** Estimated ingredient cost per serving (€) — feeds the business face. */
  estimatedCostPerServing?: number
}

const ALLERGEN_SET = new Set<string>([...INCO_ALLERGENS, 'none'])

/**
 * Tolerant parse of the Json column: unknown shapes, wrong types, legacy junk →
 * the recognisable subset (or null when nothing usable). NEVER throws.
 */
export function parseSheet(raw: unknown): DishSheet | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const out: DishSheet = {}

  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map(s => s.trim()) : undefined

  if (num(o.baseServings) !== undefined) out.baseServings = num(o.baseServings)
  if (num(o.prepMinutes)  !== undefined) out.prepMinutes  = num(o.prepMinutes)
  if (num(o.cookMinutes)  !== undefined) out.cookMinutes  = num(o.cookMinutes)
  if (typeof o.difficulty === 'string' && (DIFFICULTIES as readonly string[]).includes(o.difficulty)) {
    out.difficulty = o.difficulty as Difficulty
  }
  if (Array.isArray(o.ingredients)) {
    const ing: SheetIngredient[] = []
    for (const it of o.ingredients) {
      if (it == null || typeof it !== 'object') continue
      const r = it as Record<string, unknown>
      if (typeof r.name !== 'string' || r.name.trim() === '') continue
      ing.push({
        name: r.name.trim(),
        qty:  typeof r.qty === 'number' && Number.isFinite(r.qty) && r.qty > 0 ? r.qty : null,
        unit: typeof r.unit === 'string' ? r.unit.trim() : '',
      })
    }
    if (ing.length) out.ingredients = ing
  }
  const steps = strArr(o.steps);       if (steps?.length)  out.steps = steps
  const diet  = strArr(o.dietTags);    if (diet?.length)   out.dietTags = diet
  const equip = strArr(o.equipment);   if (equip?.length)  out.equipment = equip
  if (Array.isArray(o.allergens)) {
    const al = o.allergens.filter((a): a is AllergenChoice => typeof a === 'string' && ALLERGEN_SET.has(a))
    if (al.length) out.allergens = al.includes('none') && al.length > 1 ? al.filter(a => a !== 'none') : al
  }
  if (typeof o.platingNotes === 'string' && o.platingNotes.trim()) out.platingNotes = o.platingNotes.trim()
  if (typeof o.story === 'string' && o.story.trim()) out.story = o.story.trim()
  if (num(o.estimatedCostPerServing) !== undefined) out.estimatedCostPerServing = num(o.estimatedCostPerServing)

  return Object.keys(out).length ? out : null
}

/** D2 gate helper: a valid allergen declaration (≥1 INCO id, or explicit 'none'). */
export function hasAllergenDeclaration(sheet: DishSheet | null): boolean {
  return Boolean(sheet?.allergens && sheet.allergens.length > 0)
}

/**
 * Completeness score 0-100 (D3 — a score, NEVER a blocker). Simple weighting,
 * tilted toward what a resto actually needs in production:
 *   quantified ingredients 25 · steps 25 · allergens 15 · timings 10 ·
 *   servings 5 · difficulty 5 · cost 5 · plating 4 · story 3 · diet 2 · equip 1
 */
export function sheetCompleteness(sheet: DishSheet | null): number {
  if (!sheet) return 0
  let score = 0
  const quantified = (sheet.ingredients ?? []).filter(i => i.qty != null && i.unit !== '')
  if ((sheet.ingredients?.length ?? 0) > 0) {
    // Up to 25: full marks only when every line is quantified (qty + unit).
    score += Math.round(25 * (quantified.length / sheet.ingredients!.length))
  }
  if ((sheet.steps?.length ?? 0) >= 2) score += 25
  else if ((sheet.steps?.length ?? 0) === 1) score += 12
  if (hasAllergenDeclaration(sheet)) score += 15
  if (sheet.prepMinutes != null && sheet.cookMinutes != null) score += 10
  else if (sheet.prepMinutes != null || sheet.cookMinutes != null) score += 5
  if (sheet.baseServings != null && sheet.baseServings > 0) score += 5
  if (sheet.difficulty) score += 5
  if (sheet.estimatedCostPerServing != null) score += 5
  if (sheet.platingNotes) score += 4
  if (sheet.story) score += 3
  if ((sheet.dietTags?.length ?? 0) > 0) score += 2
  if ((sheet.equipment?.length ?? 0) > 0) score += 1
  return Math.min(100, score)
}

/** Server-side estimated gross margin pct for the BUSINESS face —
 *  (suggestedPrice − cost) / suggestedPrice, rounded; null when not computable. */
export function estimatedMarginPct(sheet: DishSheet | null, suggestedPrice: number): number | null {
  const cost = sheet?.estimatedCostPerServing
  if (cost == null || !Number.isFinite(suggestedPrice) || suggestedPrice <= 0) return null
  if (cost < 0 || cost > suggestedPrice) return null
  return Math.round(((suggestedPrice - cost) / suggestedPrice) * 100)
}

/** The PUBLIC face (D1) — strictly non-technical fields. */
export function publicFace(sheet: DishSheet | null) {
  if (!sheet) return null
  return {
    story:        sheet.story ?? null,
    dietTags:     sheet.dietTags ?? [],
    prepMinutes:  sheet.prepMinutes ?? null,
    cookMinutes:  sheet.cookMinutes ?? null,
    difficulty:   sheet.difficulty ?? null,
  }
}

/** The BUSINESS face for the resto catalogue (D1) — figures, never the asset
 *  (no quantified ingredients, no steps, no plating). */
export function businessFace(sheet: DishSheet | null, suggestedPrice: number) {
  return {
    sheetCompleteness:       sheetCompleteness(sheet),
    difficulty:              sheet?.difficulty ?? null,
    prepMinutes:             sheet?.prepMinutes ?? null,
    cookMinutes:             sheet?.cookMinutes ?? null,
    dietTags:                sheet?.dietTags ?? [],
    allergens:               sheet?.allergens ?? [],
    estimatedCostPerServing: sheet?.estimatedCostPerServing ?? null,
    estimatedMarginPct:      estimatedMarginPct(sheet, suggestedPrice),
  }
}

// ── Zod schema (API input — unknown keys stripped by z.object) ─────────────────

export const sheetSchema = z.object({
  baseServings:            z.number().positive().optional(),
  prepMinutes:             z.number().min(0).optional(),
  cookMinutes:             z.number().min(0).optional(),
  difficulty:              z.enum(DIFFICULTIES).optional(),
  ingredients:             z.array(z.object({
    name: z.string().min(1),
    qty:  z.number().positive().nullable(),
    unit: z.string(),
  })).optional(),
  steps:                   z.array(z.string().min(1)).optional(),
  allergens:               z.array(z.enum([...INCO_ALLERGENS, 'none'] as [string, ...string[]])).optional(),
  dietTags:                z.array(z.string()).optional(),
  equipment:               z.array(z.string()).optional(),
  platingNotes:            z.string().optional(),
  story:                   z.string().optional(),
  estimatedCostPerServing: z.number().min(0).optional(),
})

