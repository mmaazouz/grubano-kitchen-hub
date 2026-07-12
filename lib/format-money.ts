// ── Money formatting — single source of truth (Agent 14) ──────────────────────
//
// DISPLAY ONLY. Never mutates a stored value or a computed amount — it only turns
// an already-computed number into the string shown to the user. Amounts in this
// app are EUR for EVERY locale; only the FORMAT (decimal separator, symbol
// placement, thousands grouping) follows the active locale, via Intl.NumberFormat.
//
// ⚠️ Distinct from lib/format.ts `formatPrice`, which is MULTI-currency ($ for en,
// AED for ar). Money here is always EUR — use THESE functions for any monetary
// amount so "12,50 €" (fr) / "€12.50" (en) stay consistent everywhere.
//
// Locale: pass the active locale — next-intl's `useLocale()` (client components)
// or `getLocale()` / `params.locale` (server). Same convention as lib/format.ts.

const INTL_LOCALE: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
  it: 'it-IT',
  ar: 'ar-MA',
}

// Resolve to a FULL BCP-47 tag from the app's SUPPORTED locales only. Any
// unknown/unsupported locale falls back to 'fr-FR' — DETERMINISTIC across
// environments. We must NEVER pass a raw, unvalidated locale to Intl: for an
// unknown tag (e.g. 'zz') Intl's own fallback is ICU/Node-version dependent
// (fr-FR on one box, en-GB on another) → "works on my machine". Forcing the
// fr-FR fallback in CODE guarantees "12,50 €" everywhere (marketplace = FR).
function tag(locale: string): string {
  return INTL_LOCALE[locale] ?? 'fr-FR'
}

export interface MoneyOpts {
  /** Drop the decimals (e.g. round KPI figures like "12 500 €"). Default: 2 dp. */
  noDecimals?: boolean
}

function fmtEuros(euros: number, locale: string, opts?: MoneyOpts): string {
  const n = Number.isFinite(euros) ? euros : 0
  return new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency: 'EUR',
    ...(opts?.noDecimals ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format(n)
}

/**
 * Format an amount stored in CENTS (integer) as a localized EUR string.
 * DISPLAY only: divides by 100 for presentation, never mutates the value.
 * @example formatMoney(1250, 'fr') // "12,50 €"
 * @example formatMoney(1250, 'en') // "€12.50"
 */
export function formatMoney(cents: number, locale: string, opts?: MoneyOpts): string {
  return fmtEuros((Number.isFinite(cents) ? cents : 0) / 100, locale, opts)
}

/**
 * Format an amount already expressed in EUROS (e.g. a Float price/total column)
 * as a localized EUR string. Use this when the value is NOT in cents.
 * @example formatEuros(12.5, 'fr') // "12,50 €"
 */
export function formatEuros(euros: number, locale: string, opts?: MoneyOpts): string {
  return fmtEuros(euros, locale, opts)
}

/**
 * Format a euro amount as a localized NUMBER with NO currency symbol — for use
 * INSIDE a translation string that already supplies the unit (e.g. "{amount} €").
 * Fixes the decimal separator per locale without doubling the symbol.
 * @example formatAmount(12.5, 'fr') // "12,50"  → "12,50 € de crédit"
 * @example formatAmount(12.5, 'en') // "12.50"
 */
export function formatAmount(euros: number, locale: string, opts?: MoneyOpts): string {
  const n = Number.isFinite(euros) ? euros : 0
  return new Intl.NumberFormat(tag(locale), {
    minimumFractionDigits: opts?.noDecimals ? 0 : 2,
    maximumFractionDigits: opts?.noDecimals ? 0 : 2,
  }).format(n)
}
