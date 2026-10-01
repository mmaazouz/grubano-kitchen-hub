// lib/categories.ts
// Localisation of Grubano's FIXED system taxonomy (cuisine tags / category
// chips). These twelve categories are platform-defined, not restaurateur
// content, so they get translated.
//
// IMPORTANT: restaurateur-created menu section names (e.g. "Nos pizzas
// signature") are FREE CONTENT and must NEVER be translated. getCategoryLabel
// only maps the known system slugs and falls back to the raw input untouched,
// so free content passes through verbatim.
//
// This table is the canonical source for rendering. It is mirrored in the
// `categories` namespace of messages/*.json (kept in sync by hand — the taxonomy
// is frozen per CLAUDE.md §14) so the translation-completeness check and
// Mohammed's review surface it like every other string.

import { useLocale } from 'next-intl'
import type { Locale } from '@/i18n'

export type CategorySlug =
  | 'italien'
  | 'asiatique'
  | 'healthy'
  | 'bowls'
  | 'desserts'
  | 'burgers'
  | 'wraps'
  | 'sandwiches'
  | 'pizza'
  | 'sushi'
  | 'pates'
  | 'boissons'

/** Localised label for every fixed system category, per locale. */
const CATEGORY_LABELS: Record<Locale, Record<CategorySlug, string>> = {
  fr: {
    italien: 'Italien',
    asiatique: 'Asiatique',
    healthy: 'Healthy',
    bowls: 'Bowls',
    desserts: 'Desserts',
    burgers: 'Burgers',
    wraps: 'Wraps',
    sandwiches: 'Sandwiches',
    pizza: 'Pizza',
    sushi: 'Sushi',
    pates: 'Pâtes',
    boissons: 'Boissons',
  },
  en: {
    italien: 'Italian',
    asiatique: 'Asian',
    healthy: 'Healthy',
    bowls: 'Bowls',
    desserts: 'Desserts',
    burgers: 'Burgers',
    wraps: 'Wraps',
    sandwiches: 'Sandwiches',
    pizza: 'Pizza',
    sushi: 'Sushi',
    pates: 'Pasta',
    boissons: 'Drinks',
  },
  es: {
    italien: 'Italiana',
    asiatique: 'Asiática',
    healthy: 'Saludable',
    bowls: 'Bowls',
    desserts: 'Postres',
    burgers: 'Burgers',
    wraps: 'Wraps',
    sandwiches: 'Sándwiches',
    pizza: 'Pizza',
    sushi: 'Sushi',
    pates: 'Pasta',
    boissons: 'Bebidas',
  },
  it: {
    italien: 'Italiana',
    asiatique: 'Asiatica',
    healthy: 'Salutare',
    bowls: 'Bowls',
    desserts: 'Dolci',
    burgers: 'Burgers',
    wraps: 'Wrap',
    sandwiches: 'Panini',
    pizza: 'Pizza',
    sushi: 'Sushi',
    pates: 'Pasta',
    boissons: 'Bevande',
  },
  ar: {
    italien: 'إيطالي',
    asiatique: 'آسيوي',
    healthy: 'صحي',
    bowls: 'أطباق',
    desserts: 'حلويات',
    burgers: 'برجر',
    wraps: 'لفائف',
    sandwiches: 'سندويشات',
    pizza: 'بيتزا',
    sushi: 'سوشي',
    pates: 'معكرونة',
    boissons: 'مشروبات',
  },
}

// Map the many spellings a cuisine tag can arrive as (FR/EN, singular/plural,
// accented or not) onto a single canonical slug.
const SLUG_ALIASES: Record<string, CategorySlug> = {
  italien: 'italien',
  italienne: 'italien',
  italian: 'italien',
  italiana: 'italien',
  italiano: 'italien',
  asiatique: 'asiatique',
  asian: 'asiatique',
  asiatica: 'asiatique',
  asiatico: 'asiatique',
  healthy: 'healthy',
  sain: 'healthy',
  saine: 'healthy',
  saludable: 'healthy',
  salutare: 'healthy',
  bowl: 'bowls',
  bowls: 'bowls',
  dessert: 'desserts',
  desserts: 'desserts',
  postres: 'desserts',
  dolci: 'desserts',
  burger: 'burgers',
  burgers: 'burgers',
  hamburger: 'burgers',
  wrap: 'wraps',
  wraps: 'wraps',
  sandwich: 'sandwiches',
  sandwiches: 'sandwiches',
  panini: 'sandwiches',
  pizza: 'pizza',
  pizzas: 'pizza',
  sushi: 'sushi',
  pate: 'pates',
  pates: 'pates',
  pasta: 'pates',
  noodles: 'pates',
  boisson: 'boissons',
  boissons: 'boissons',
  drink: 'boissons',
  drinks: 'boissons',
  bebidas: 'boissons',
  bevande: 'boissons',
}

/** Normalise an arbitrary cuisine string to a known system slug, or null. */
export function normalizeCategorySlug(raw: string): CategorySlug | null {
  const norm = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
  return SLUG_ALIASES[norm] ?? null
}

/**
 * Localised label for a category. If `raw` is a known system category it is
 * translated for `locale`; otherwise (restaurateur free content) it is returned
 * unchanged.
 */
export function getCategoryLabel(raw: string, locale: string): string {
  const slug = normalizeCategorySlug(raw)
  if (!slug) return raw
  const table = CATEGORY_LABELS[locale as Locale] ?? CATEGORY_LABELS.fr
  return table[slug] ?? raw
}

/** React hook: returns a `(raw) => label` mapper bound to the active locale. */
export function useCategoryLabel(): (raw: string) => string {
  const locale = useLocale()
  return (raw: string) => getCategoryLabel(raw, locale)
}

/**
 * Localise a list of cuisine tags and join them for display.
 * Falls back to `fallback` when the list is empty.
 */
export function formatCuisineList(
  cuisine: string[] | undefined,
  locale: string,
  fallback: string,
): string {
  if (!Array.isArray(cuisine) || cuisine.length === 0) return fallback
  return cuisine.map((c) => getCategoryLabel(c, locale)).join(' • ')
}
