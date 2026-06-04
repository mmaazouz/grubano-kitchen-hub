import { cache } from 'react'
import { locales, defaultLocale, type Locale } from '@/i18n'
import { prisma } from '@/lib/prisma'

// ── Canonical site origin ─────────────────────────────────────────────────────
// Single source of truth for absolute URLs in metadata, hreflang, sitemap,
// JSON-LD and OG images. Override per-environment with NEXT_PUBLIC_SITE_URL
// (e.g. https://app.grubano.com on staging). Defaults to the production host.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.grubano.com'
).replace(/\/+$/, '')

export const BRAND_NAME = 'Grubano'

// og:locale uses the language_TERRITORY form. Arabic targets Morocco (ar_MA),
// matching the translation locale used across the app.
const OG_LOCALE: Record<Locale, string> = {
  fr: 'fr_FR',
  en: 'en_US',
  es: 'es_ES',
  ar: 'ar_MA',
  it: 'it_IT',
}

export function ogLocale(locale: Locale): string {
  return OG_LOCALE[locale] ?? OG_LOCALE[defaultLocale]
}

/** Every og:locale except the active one — for og:locale:alternate. */
export function ogAlternateLocales(active: Locale): string[] {
  return locales.filter((l) => l !== active).map((l) => OG_LOCALE[l])
}

/** Absolute URL for a locale-prefixed path. `path` must start with '/' (or be ''). */
export function absoluteUrl(locale: Locale, path = ''): string {
  return `${SITE_URL}/${locale}${path}`
}

/**
 * Coerce a possibly-relative asset URL to absolute. Already-absolute URLs
 * (http/https) pass through unchanged; root-relative paths get the site origin.
 * Returns undefined for empty/nullish input so callers can omit the field.
 */
export function toAbsolute(url?: string | null): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  return `${SITE_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

/** Clamp a meta description to ~155 chars on a word boundary (no mid-word cut). */
export function clamp(text: string, max = 155): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Build the `alternates` block for generateMetadata: a self-referencing
 * canonical for the active locale, plus hreflang links for all 5 locales and
 * an x-default pointing at the French (default) version.
 *
 * `path` is the locale-agnostic route, e.g. '/eat' or `/eat/r/${id}` ('' = home).
 */
export function buildAlternates(active: Locale, path = '') {
  const languages: Record<string, string> = {}
  for (const l of locales) languages[l] = absoluteUrl(l, path)
  languages['x-default'] = absoluteUrl(defaultLocale, path)
  return {
    canonical: absoluteUrl(active, path),
    languages,
  }
}

// ── Cached restaurant lookups (request-deduped) ───────────────────────────────
// generateMetadata, the JSON-LD render and the OG image can all need the same
// restaurant within one request. React.cache() memoizes the Prisma call so it
// runs once per request instead of three times.
export const getRestaurantSeo = cache(async (id: string) => {
  try {
    return await prisma.restaurant.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        coverPhoto: true,
        cuisine: true,
        rating: true,
        reviewCount: true,
        city: true,
        address: true,
        lat: true,
        lng: true,
      },
    })
  } catch {
    return null
  }
})

/** Cuisine is a JSON column; coerce to a clean string[] defensively. */
export function cuisineList(cuisine: unknown): string[] {
  if (!Array.isArray(cuisine)) return []
  return cuisine.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
}

// ── Metadata builders ─────────────────────────────────────────────────────────
// Next.js OVERWRITES (does not deep-merge) the openGraph / twitter objects when
// a child segment redefines them, so each public page rebuilds the full block.
// The actual og:image / twitter:image come from the file-based opengraph-image /
// twitter-image conventions and are injected automatically — no need to set
// images here. These helpers keep title/description/locale consistent.

interface SocialOpts {
  title: string
  description: string
  /** locale-agnostic path, e.g. '/eat' (default '' = home). */
  path?: string
  /**
   * Absolute OG image URL. Pass `defaultOgImage(locale)` for pages that have no
   * colocated opengraph-image file (the file convention applies to its OWN
   * segment only — it does NOT inherit to child routes). Omit on pages that DO
   * have a colocated opengraph-image (e.g. the restaurant page) so Next injects
   * that one automatically.
   */
  image?: string
}

/** URL of the default branded OG image (app/[locale]/opengraph-image.tsx). */
export function defaultOgImage(locale: Locale): string {
  return absoluteUrl(locale, '/opengraph-image')
}

export function ogBase(locale: Locale, opts: SocialOpts) {
  return {
    type: 'website' as const,
    siteName: BRAND_NAME,
    title: opts.title,
    description: opts.description,
    url: absoluteUrl(locale, opts.path ?? ''),
    locale: ogLocale(locale),
    alternateLocale: ogAlternateLocales(locale),
    ...(opts.image
      ? { images: [{ url: opts.image, width: 1200, height: 630, alt: BRAND_NAME }] }
      : {}),
  }
}

export function twitterBase(opts: { title: string; description: string; image?: string }) {
  return {
    card: 'summary_large_image' as const,
    title: opts.title,
    description: opts.description,
    ...(opts.image ? { images: [opts.image] } : {}),
  }
}
