import { INCO_ALLERGENS, type AllergenChoice } from '@/lib/dish-sheet'

// ── Supplier catalogue — PURE helpers (B2B Slice 1, Agent 14) ─────────────────
// No I/O, no server imports → safe to import from BOTH client (the catalogue page)
// and server (the API routes). Prices are integer CENTS everywhere; this is the
// single euros↔cents boundary. Allergens reuse the INCO ids (lib/dish-sheet).

export const CATALOG_UNITS = ['kg', 'g', 'L', 'cl', 'piece', 'box', 'pack'] as const
export type CatalogUnit = (typeof CATALOG_UNITS)[number]

// Case-insensitive lookup → canonical unit (so a CSV "l" / "KG" maps to 'L' / 'kg').
const UNIT_BY_LOWER: Record<string, CatalogUnit> =
  Object.fromEntries(CATALOG_UNITS.map((u) => [u.toLowerCase(), u])) as Record<string, CatalogUnit>

const ALLERGEN_SET = new Set<string>([...INCO_ALLERGENS, 'none'])

/**
 * Euros (number from a € input, or a CSV string with a comma/point decimal) →
 * integer CENTS. Returns null for a non-finite / negative / unparseable value.
 */
export function eurosToCents(input: number | string): number | null {
  let n: number
  if (typeof input === 'number') {
    n = input
  } else {
    const cleaned = input.trim().replace(/\s/g, '').replace('€', '').replace(',', '.')
    if (cleaned === '') return null
    n = Number(cleaned)
  }
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Coerce a raw allergens list to valid INCO ids (+ 'none'); drops unknowns, dedupes. */
export function normalizeAllergens(raw: unknown): AllergenChoice[] {
  if (!Array.isArray(raw)) return []
  const out: AllergenChoice[] = []
  for (const v of raw) {
    const s = String(v).trim().toLowerCase()
    if (ALLERGEN_SET.has(s) && !out.includes(s as AllergenChoice)) out.push(s as AllergenChoice)
  }
  return out
}

export interface ParsedCatalogRow {
  name: string
  description?: string
  category: string
  priceCents: number
  unit: CatalogUnit
  packSize?: string
  available: boolean
  allergens: AllergenChoice[]
}

export interface CatalogCsvResult {
  valid: ParsedCatalogRow[]
  errors: { line: number; message: string }[]
}

/** Split one CSV line into trimmed fields, honouring "double quotes" (with "" escapes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += c
    } else if (c === '"') {
      inQ = true
    } else if (c === ',') {
      out.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parseBool(s: string, dflt: boolean): boolean {
  const v = s.trim().toLowerCase()
  if (['1', 'true', 'yes', 'oui', 'vrai', 'o', 'y'].includes(v)) return true
  if (['0', 'false', 'no', 'non', 'faux', 'n'].includes(v)) return false
  return dflt
}

/**
 * Parse a catalogue CSV into valid rows + per-line errors. NEVER throws.
 * Columns (header, case-insensitive): name, price, unit, category, packSize,
 * description, available, allergens. Only `name` + `price` are REQUIRED.
 * - price: euros (comma or point) → priceCents
 * - unit: one of CATALOG_UNITS (default 'piece' when blank; an unknown value errors)
 * - available: oui/non/true/false/1/0 (default true)
 * - allergens: ';' or '|' separated INCO ids (unknowns dropped)
 * In-file duplicate names are reported (not created). DB-level duplicates (a name
 * already in the supplier's catalogue) are skipped at insert (createMany), never
 * overwritten.
 * Caveat: assumes no newline inside a quoted field (documented limitation).
 */
export function parseCatalogCsv(text: string): CatalogCsvResult {
  const valid: ParsedCatalogRow[] = []
  const errors: { line: number; message: string }[] = []

  // Keep ORIGINAL line indices (blank lines are skipped, NOT removed) so reported
  // error line numbers always match what the user sees in their file.
  const rawLines = text.split(/\r\n|\r|\n/)
  const headerIdx = rawLines.findIndex((l) => l.trim() !== '')
  if (headerIdx < 0) {
    return { valid, errors: [{ line: 0, message: 'CSV vide ou sans ligne de données.' }] }
  }

  const header = parseCsvLine(rawLines[headerIdx]).map((h) => h.toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const idx = {
    name: col('name'), price: col('price'), unit: col('unit'), category: col('category'),
    packSize: col('packsize'), description: col('description'),
    available: col('available'), allergens: col('allergens'),
  }
  if (idx.name < 0 || idx.price < 0) {
    return { valid, errors: [{ line: headerIdx + 1, message: 'En-tête invalide : les colonnes « name » et « price » sont requises.' }] }
  }

  const seen = new Set<string>()
  let dataRows = 0
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    if (rawLines[i].trim() === '') continue // skip blank lines, preserve ORIGINAL numbering
    dataRows++
    const cells = parseCsvLine(rawLines[i])
    const get = (j: number) => (j >= 0 && j < cells.length ? cells[j] : '')
    const lineNo = i + 1 // ORIGINAL 1-based line number (header is line 1)

    const name = get(idx.name)
    if (!name) { errors.push({ line: lineNo, message: 'Nom manquant.' }); continue }

    const priceCents = eurosToCents(get(idx.price))
    if (priceCents === null) { errors.push({ line: lineNo, message: `Prix invalide pour « ${name} ».` }); continue }

    const unit = UNIT_BY_LOWER[(get(idx.unit) || 'piece').toLowerCase()]
    if (!unit) {
      errors.push({ line: lineNo, message: `Unité « ${get(idx.unit)} » inconnue pour « ${name} » (kg, g, L, cl, piece, box, pack).` })
      continue
    }

    const key = name.toLowerCase()
    if (seen.has(key)) { errors.push({ line: lineNo, message: `Doublon « ${name} » dans le fichier.` }); continue }
    seen.add(key)

    const allergens = normalizeAllergens(
      get(idx.allergens).split(/[;|]/).map((s) => s.trim()).filter(Boolean),
    )

    valid.push({
      name,
      description: get(idx.description) || undefined,
      category: get(idx.category) || 'autre',
      priceCents,
      unit,
      packSize: get(idx.packSize) || undefined,
      available: parseBool(get(idx.available), true),
      allergens,
    })
  }

  if (dataRows === 0) errors.push({ line: 0, message: 'CSV vide ou sans ligne de données.' })
  return { valid, errors }
}
