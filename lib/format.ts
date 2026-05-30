// Locale-aware formatting helpers built on the native Intl APIs.
// Keep all user-facing number/date/time formatting going through here so the
// output matches the active locale's conventions.

const CURRENCY_BY_LOCALE: Record<string, string> = {
  fr: 'EUR',
  es: 'EUR',
  it: 'EUR',
  en: 'USD',
  ar: 'AED',
}

// BCP-47 tags — EN defaults to US conventions (2:30 PM, $), AR to Moroccan.
const INTL_LOCALE: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
  it: 'it-IT',
  ar: 'ar-MA',
}

function tag(locale: string): string {
  return INTL_LOCALE[locale] ?? locale
}

/** "12,50 €" (FR), "$12.50" (EN), "12,50 €" (ES/IT), "١٢٫٥٠ د.م." (AR) */
export function formatPrice(amount: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency: CURRENCY_BY_LOCALE[locale] ?? 'EUR',
  }).format(amount)
}

/** Plain number with locale grouping/decimals. */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale)).format(value)
}

/** "15 mars 2026" (FR), "March 15, 2026" (EN), etc. */
export function formatDate(date: Date | string | number, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(date))
}

/** "14:30" (FR/EU 24h), "2:30 PM" (EN-US 12h). */
export function formatTime(date: Date | string | number, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

/** Short date + time, e.g. "15 mars, 14:30". */
export function formatDateTime(date: Date | string | number, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}
