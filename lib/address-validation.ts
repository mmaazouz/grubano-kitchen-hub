// ── Strict-FRANCE address-field validation (beta-truth train) ─────────────────
// Single source shared by POST /api/restaurants (onboarding / add-establishment)
// and PATCH /api/restaurants/[id] (post-onboarding address edit), plus their
// client-side mirrors — so the create and edit surfaces can never drift apart.
// Pure functions, no server-only imports: safe in 'use client' components.
//
// Banked trap: tsconfig has no es6+ target, so a /\p{Nd}/u LITERAL fails to
// compile under tsc — build the regex via new RegExp(), the same workaround as
// lib/customer-initials.ts.

const UNICODE_DIGITS_ONLY_RE = new RegExp('^\\p{Nd}+$', 'u')

/**
 * True when the value is nothing but decimal digits in ANY script — ASCII
 * "30210", fullwidth "３０２１０" (mobile/IME input), Arabic-Indic "٣٠٢١٠"…
 * NFKC-normalized first so presentation forms collapse to canonical digits.
 * This is the "postal code typed in the city field" gate (the exact inversion
 * seen in the human rehearsal): a city must be a NAME, never a number.
 */
export function isNumericOnly(value: string): boolean {
  return UNICODE_DIGITS_ONLY_RE.test(value.normalize('NFKC'))
}

/**
 * French postal code: EXACTLY 5 digits. Returns the trimmed, NFKC-normalized
 * value ("３０２１０" → "30210") or null when invalid. The CP is never
 * persisted — it only sharpens the BAN/IGN geocode match.
 */
export function normalizeFrenchPostalCode(value: string): string | null {
  const v = value.trim().normalize('NFKC')
  return /^\d{5}$/.test(v) ? v : null
}

// UI-facing API error messages (French per code rules, vouvoiement register) —
// one source for both routes so the wording can't diverge between create & edit.
export const ADDRESS_FIELD_ERRORS = {
  invalidAddress:     'Adresse invalide — saisissez une adresse complète (numéro et rue).',
  invalidCityNumeric: 'Ville invalide — saisissez un nom de ville (ex. « Fournès »), pas un code postal.',
  invalidCity:        'Ville invalide — saisissez le nom d’une vraie ville.',
  invalidPostalCode:  'Code postal invalide — 5 chiffres attendus (ex. « 30210 »).',
} as const
